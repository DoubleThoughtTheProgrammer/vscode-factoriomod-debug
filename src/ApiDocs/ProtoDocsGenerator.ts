import { LuaLSAlias, LuaLSArray, LuaLSClass, LuaLSDict, LuaLSField, LuaLSFile, LuaLSFunction, LuaLSLiteral, LuaLSParam, LuaLSTuple, LuaLSType, LuaLSTypeName, LuaLSUnion } from "./LuaLS";
import type { DocSettings } from "./DocSettings";

export class ProtoDocGenerator<V extends ProtoVersions = ProtoVersions> {
	private readonly docs:ProtoDocs<V>;

	private readonly concepts:Map<string, ProtoConcept>;
	private readonly simple_structs:Set<string>;
	private readonly prototypes:Map<string, ProtoPrototype>;

	private readonly type_prefix = "data.";

	constructor(docjson:string, docsettings:DocSettings) {
		this.docs = JSON.parse(docjson);

		if (this.docs.application !== "factorio") {
			throw `Unknown application: ${this.docs.application}`;
		}

		if (!(this.docs.api_version===4)) {
			throw `Unsupported JSON Version ${this.docs.api_version}`;
		}

		if (this.docs.stage !== "prototype") {
			throw `Wrong stage: ${this.docs.stage}`;
		}

		this.concepts = new Map(this.docs.types.map(c=>[c.name, c]));
		this.simple_structs = new Set();
		for (const [name, concept] of this.concepts) {
			if (typeof concept.type === "object" && concept.type.complex_type === "struct") {
				this.simple_structs.add(name);
			}
		}
		this.prototypes = new Map(this.docs.prototypes.map(c=>[c.name, c]));

	}

	public get api_version() : V {
		return this.docs.api_version;
	}

	public get stage() : string {
		return this.docs.stage;
	}

	public get application() : string {
		return this.docs.application;
	}

	public get application_version() : string {
		return this.docs.application_version;
	}

	public resolve_link(member:string, part?:string):string {
		part = part ? `#${part}` : "";
		if (['prototypes', 'types'].includes(member)) {
			return `/${member}.html${part}`;
		}
		if (this.concepts.has(member)) {
			return `/types/${member}.html${part}`;
		}
		if (this.prototypes.has(member)) {
			return `/prototypes/${member}.html${part}`;
		}
		throw new Error("Invalid Link");
	}

	public generate_LuaLS_docs(
		format_description:DescriptionFormatter
	):(LuaLSFile|Promise<LuaLSFile>)[] {
		return [
			this.generate_LuaLS_concepts(format_description),
			this.generate_LuaLS_prototypes(format_description),
			this.generate_LuaLS_data(format_description),
		];
	}

	private async generate_LuaLS_concepts(format_description:DescriptionFormatter): Promise<LuaLSFile> {
		const file = new LuaLSFile("prototypes-concepts", this.application_version);

		for (const [_, concept] of this.concepts) {
			if (concept.type === "builtin") {
				continue;
			}
			const simple = this.simple_structs.has(concept.name);
			const suffix = simple?"":".struct";
			if (concept.properties) {
				const lsclass = new LuaLSClass(this.type_prefix+concept.name+suffix);
				lsclass.description = await format_description(concept.description, "prototype", concept.name);
				if (concept.parent) {
					lsclass.parents = [new LuaLSTypeName(this.type_prefix+concept.parent+suffix)];
				}
				lsclass.fields = [];
				for (const prop of concept.properties) {
					const field = new LuaLSField(prop.name, this.lua_proto_type(prop.type));
					field.description = await format_description(prop.description, "prototype", concept.name, prop.name);
					field.optional = prop.optional;
					lsclass.fields.push(field);
				}

				file.add(lsclass);
			}

			if (!simple) {
				file.add(new LuaLSAlias(this.type_prefix+concept.name, this.lua_proto_type(concept.type, concept), concept.description));
			}
		}

		return file;
	}

	private generate_LuaLS_data(format_description:DescriptionFormatter): LuaLSFile {
		const file = new LuaLSFile("prototypes-data", this.application_version);
		const data = new LuaLSClass("data");
		data.fields = [
			new LuaLSField("raw", new LuaLSTypeName("data.raw")),
			new LuaLSField("is_demo", new LuaLSTypeName("boolean")),
		];
		const extend = new LuaLSFunction("extend");
		extend.params = [
			new LuaLSParam("self", new LuaLSTypeName("data")),
			new LuaLSParam("otherdata", new LuaLSArray(new LuaLSTypeName("data.PrototypeBase"))),
		];
		data.functions = [extend];
		data.global_name = "data";
		file.add(data);
		const dataraw = new LuaLSClass("data.raw");
		dataraw.fields = [];
		file.add(dataraw);

		for (const [_, prototype] of this.prototypes) {
			if (prototype.typename) {
				dataraw.fields.push(new LuaLSField(new LuaLSLiteral(prototype.typename), new LuaLSDict(new LuaLSTypeName("string"), new LuaLSTypeName(this.type_prefix+prototype.name) )));
			}
		}

		return file;
	}

	private async generate_LuaLS_prototypes(format_description:DescriptionFormatter): Promise<LuaLSFile> {
		const file = new LuaLSFile("prototypes", this.application_version);

		for (const [_, prototype] of this.prototypes) {

			const lsproto = new LuaLSClass(this.type_prefix+prototype.name);
			lsproto.description = await format_description(prototype.description, "prototype", prototype.name);
			if (prototype.parent) {
				lsproto.parents = [new LuaLSTypeName(this.type_prefix+prototype.parent)];
			}
			lsproto.fields = [];
			for (const prop of prototype.properties) {
				const field = new LuaLSField(prop.name, this.lua_proto_type(prop.type));
				field.description = await format_description(prop.description, "prototype", prototype.name, prop.name);
				field.optional = prop.optional;
				lsproto.fields.push(field);
				if (prop.alt_name) {
					const field = new LuaLSField(prop.alt_name, this.lua_proto_type(prop.type));
					field.description = await format_description(prop.description, "prototype", prototype.name, prop.alt_name);
					field.optional = prop.optional;
					lsproto.fields.push(field);
				}
			}
			if (prototype.custom_properties) {
				const prop = prototype.custom_properties;
				const field = new LuaLSField(this.lua_proto_type(prop.key_type), this.lua_proto_type(prop.value_type));
				field.description = await format_description(prop.description, "prototype", prototype.name, "custom_properties");
				lsproto.fields.push(field);
			}
			file.add(lsproto);
		}
		return file;
	}

	private lua_proto_type(type:ProtoType, parent?:ProtoConcept):LuaLSType {
		switch (typeof type) {
			case "string":
				switch (type) {
					case "bool":
						return new LuaLSTypeName("boolean");
					case "boolean":
					case "string":
					case "float":
					case "double":
					case "int8":
					case "uint8":
					case "int16":
					case "uint16":
					case "int32":
					case "uint32":
					case "int64":
					case "uint64":
						return new LuaLSTypeName(type);
				}
				return new LuaLSTypeName(this.type_prefix+type);
			case "object":
				switch (type.complex_type) {
					case "struct":
						if (!parent) {
							throw new Error("struct without parent");
						}
						if (this.simple_structs.has(parent.name)) {
							return new LuaLSTypeName(this.type_prefix+parent.name);
						}
						return new LuaLSTypeName(this.type_prefix+parent.name+".struct");
					case "array":
						return new LuaLSArray(this.lua_proto_type(type.value, parent));
					case "tuple":
						return new LuaLSTuple(type.values.map(v=>this.lua_proto_type(v, parent)));
					case "dictionary":
						return new LuaLSDict(this.lua_proto_type(type.key, parent), this.lua_proto_type(type.value, parent));
					case "union":
						return new LuaLSUnion(type.options.map(v=>this.lua_proto_type(v, parent)));
					case "literal":
						return new LuaLSLiteral(type.value);
					case "type":
						return this.lua_proto_type(type.value, parent);

					default:
						throw new Error("Invalid Type");
				}
			default:
				throw new Error("Invalid Type");
		}
	}
}