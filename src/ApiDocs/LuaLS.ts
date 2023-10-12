import type { Writable } from "stream";
import { version as bundleVersion } from "../../package.json";

export function escape_lua_keyword(str:string) {
	const keywords = ["and", "break", "do", "else", "elseif", "end", "false", "for",
		"function", "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return",
		"then", "true", "until", "while"];
	return keywords.includes(str)?`${str}_`:str;
}

export function to_lua_ident(str:string) {
	return escape_lua_keyword(str.replace(/[^a-zA-Z0-9]/g, "_").replace(/^([0-9])/, "_$1"));
}



async function format_lua_description(output:Writable, description?:string) {
	if (!description) { return; }
	output.write(`---${description.replace(/\n/g, "\n---")}\n`);
}

export class LuaLSFile {
	constructor(
		public name:string,
		public app_version:string,
	) {}

	meta?:string = "_";

	members?:(LuaLSFunction|LuaLSClass|LuaLSAlias|LuaLSEnum)[];

	add(member:LuaLSFunction|LuaLSClass|LuaLSAlias|LuaLSEnum) {
		if (!this.members) {
			this.members = [];
		}
		this.members.push(member);
	}

	async write(output:Writable) {
		if (typeof this.meta === "string") {
			output.write(`---@meta ${this.meta}\n`);
		}
		//output.write(`---@diagnostic disable\n`);
		output.write(`\n`);
		output.write(`--$Factorio ${this.app_version}\n`);
		output.write(`--$Generator ${bundleVersion}\n`);
		output.write(`--$Section ${this.name}\n`);
		output.write(`-- This file is automatically generated. Edits will be overwritten without warning.\n`);
		output.write(`\n`);

		if (this.members) {
			for (const member of this.members) {
				await member.write(output);
			}
		}

	}
}

export type LuaLSType = LuaLSTypeName|LuaLSLiteral|LuaLSFunction|LuaLSDict|LuaLSTuple|LuaLSArray|LuaLSUnion;

export class LuaLSTypeName {
	constructor(
		public name:string,
		public generic_args?:LuaLSType[]
	) {}

	format() {
		return this.name;
	}
}

export class LuaLSLiteral {
	constructor(
		public value:string|number|boolean,
	) {}
	format() {
		switch (typeof this.value) {
			case "string":
				return `"${this.value}"`;
			case "number":
			case "boolean":
				return this.value.toString();

			default:
				throw new Error("Invalid value");

		}
	}
}

export class LuaLSDict {
	constructor(
		public key:LuaLSType,
		public value:LuaLSType,
	) {}


	format():string {
		return `{[${this.key.format()}]:${this.value.format()}}`;
	}
}

export class LuaLSArray {
	constructor(
		public member:LuaLSType,
	) {}

	format():string {
		return `(${this.member.format()})[]`;
	}
}

export class LuaLSTuple {
	constructor(
		public members:LuaLSType[],
	) {}

	format():string {
		return `{${this.members.map((m, i)=>`[${i+1}]:${m.format()}`).join(", ")}}`;
	}
}

export class LuaLSUnion {
	constructor(
		public members:LuaLSType[],
	) {}

	format():string {
		return this.members.map(m=>`(${m.format()})`).join("|");
	}
}

export class LuaLSAlias {
	constructor(
		public name:string,
		public type:LuaLSType,
		public description?:string,
	) {}


	async write(output:Writable) {
		await format_lua_description(output, this.description);
		output.write(`---@alias ${this.name} ${this.type.format()}\n\n`);
	}
}

export class LuaLSEnum {
	constructor(
		public name:string,
		public fields:LuaLSEnumField[],
	) {}
	description?:string;


	async write(output:Writable) {
		await format_lua_description(output, this.description);
		output.write(`---@enum ${this.name}\n`);

		output.write(`${this.name}={\n`);
		for (const field of this.fields) {
			await field.write(output);
		}
		output.write(`}\n`);
	}
}

export class LuaLSEnumField {
	constructor(
		public name:string,
		public description?:string,
	) {}

	async write(output:Writable) {
		await format_lua_description(output, this.description);
		output.write(`${this.name}=#{},\n`);
	}
}

export class LuaLSClass {
	constructor(
		public name:string,
	) {}
	description?:string;
	parents?:LuaLSType[];
	generic_args?:string[];
	global_name?:string;

	fields?:LuaLSField[];
	functions?:LuaLSFunction[];

	call_op?:LuaLSOverload;

	async write(output:Writable) {
		await format_lua_description(output, this.description);
		output.write(`---@class ${this.name}`);
		if (this.parents) {
			output.write(`:${this.parents.map(t=>t.format()).join(", ")}`);
		}
		output.write(`\n`);

		if (this.fields) {
			for (const field of this.fields) {
				await field.write(output);
			}
		}

		if (this.global_name && !this.functions) {
			output.write(`${this.global_name}={}\n`);
		} else if (this.functions) {
			output.write(`${this.global_name ?? ("local " + to_lua_ident(this.name))}={\n`);
			for (const func of this.functions) {
				await func.write(output);
			}
			output.write(`}\n`);
		}

		output.write(`\n`);
	}

	format():string {
		if ( this.description || this.parents || this.generic_args || this.global_name || this.functions || this.call_op) {
			throw new Error("Can't inline table with unsupported features");

		}
		if (!this.fields) {
			return `{}`;
		}
		return `{${this.fields.map((f, i)=>{
			if (typeof f.name === "string") {
				return `${f.name}:${f.type.format()}`;
			}
			return `[${f.name.format()}]:${f.type.format()}`;
		}).join(", ")}}`;
	}
}

export class LuaLSField {
	constructor(
		public name:string|LuaLSType,
		public type:LuaLSType,
	) {}
	description?:string;
	optional?:boolean;

	async write(output:Writable) {
		await format_lua_description(output, this.description);

		output.write(`---@field `);
		if (typeof this.name === "string") {
			output.write(this.name);
		} else {
			output.write(`[${this.name.format()}]`);
		}
		if (this.optional) {
			output.write(`?`);
		}
		output.write(` ${this.type.format()}\n`);

	}
}

export class LuaLSOverload {
	params?:LuaLSParam[];
	returns?:LuaLSReturn[];

	write(output:Writable) {

	}
}

export class LuaLSFunction {
	constructor(
		public name:string|undefined,
		public params?:LuaLSParam[]|undefined,
		public returns?:LuaLSReturn[]|undefined,
	) {}
	description?:string;

	overloads?:LuaLSOverload[];

	nodiscard?:boolean;

	async write(output:Writable) {
		await format_lua_description(output, this.description);
		if (this.params) {
			for (const param of this.params) {
				param.write(output);
			}
		}
		if (this.returns) {
			for (const ret of this.returns) {
				ret.write(output);
			}
		}
		output.write(`${this.name} = function(`);
		if (this.params) {
			output.write(this.params.map(p=>p.name).join(", "));
		}
		output.write(`) end;\n`);
	}

	format():string {
		let params = "";
		if (this.params) {
			params = this.params.map(p=>`${p.name}:${p.type.format()}`).join(", ");
		}
		let returns = "";
		if (this.returns) {
			returns = `:${this.returns.map(r=>r.type.format()).join(", ")}`;
		}
		return `fun(${params})${returns}`;
	}
}

export class LuaLSParam {
	constructor(
		public name:string,
		public type:LuaLSType,
	) {}
	description?:string;
	optional?:boolean;

	write(output:Writable) {
		output.write(`---@param ${this.name}${this.optional?"?":""} ${this.type.format()} ${this.description??""}\n`);
	}
}

export class LuaLSReturn {
	constructor(
		public type:LuaLSType,
		public name?:string,
	) {}
	description?:string;
	optional?:boolean;

	write(output:Writable) {
		output.write(`---@return ${this.type.format()}${this.optional?"?":""} ${this.name??""} #${this.description??""}\n`);
	}
}