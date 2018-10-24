import mongoose, {Schema} from 'mongoose';
const mpathPlugin = require('mongoose-mpath');
import uuid from 'uuid/v4';
import uuidValidate from 'uuid-validate';
import {Origami} from 'origami-core-lib';


const PLUGIN_TREE_OPTIONS = {
    pathSeparator: '#', // String used to separate ids in path
    onDelete: 'REPARENT', // 'REPARENT' or 'DELETE'
    idType: String // Type used for model id
};


interface Query {
    _id?: string;
    deletedAt?: Date | null;
    [key: string]: any;
}


interface toJSONHidden { hidden?: boolean; }

interface MongoDocument {
    _id: any;
    deletedAt?: Date | null;
    [key: string]: any;
}

interface MongoDocumentWithPlugins extends MongoDocument, mongoose.Document {
    toJSONHidden(opts: toJSONHidden): object;
    children?: MongoDocumentWithPlugins[];
}

export default class Model implements Origami.Store.Model {
    name: string;

    private _schemaObj: Origami.Store.Schema;
    private _schema: Schema;
    private _isTree: boolean = false;
    private _model: mongoose.Model<any>;

    constructor(name: string, schema: Origami.Store.Schema) {
        this.name = name;
        this._schemaObj = schema;
        this._schema = new mongoose.Schema(this._parseFrom(schema));

        // Update .toJSONHidden method on schema to remove hidden fields
        this._addMethods();

        if (schema.tree) {
            this._isTree = true;
            this._schema.plugin(mpathPlugin, PLUGIN_TREE_OPTIONS);
        }

        this._model = mongoose.model(name, this._schema);
    }

    // List of properties that have `hidden: true` in the schema
    get hiddenFields() {
        return Object.entries(this._schemaObj.properties)
            .map(([name, prop]) => {
                if (prop.hidden === true) return name;
            })
            .filter(n => n) as string[];
    }

    private _addMethods() {
        const hidden = this.hiddenFields;


        // Remove the hidden fields from the result
        this._schema.methods.toJSONHidden = function toJSONHidden(opts: toJSONHidden) {
            const obj = this.toObject();

            if (opts.hidden !== true) hidden.forEach(f => delete obj[f]);

            return obj;
        };
    }

    // Parse the schema from Origami standard to Mongoose standard
    private _parseFrom(schema: Origami.Store.Schema) {
        const parsed: {
            [key: string]: any;
        } = {};
        Object.entries(schema.properties).forEach(([pName, prop]) => {
            let p = prop;
            let name = pName;
            if (typeof p === 'string') {
                p = {
                    type: p
                };
            }
            if (name === 'id') name = '_id';

            parsed[name] = p;

            if (p.type instanceof Array) {
                parsed[name].type = mongoose.Schema.Types.Mixed;
            } else {
                switch (p.type) {
                    case 'email':
                        parsed[name].type = String;
                        break;
                    case 'uuid':
                        parsed[name].type = String;
                        parsed[name].default = () => uuid();
                        break;
                }
            }

            if (p.unique) {
                parsed[name].index = {
                    unique: true
                };
            }
        });
        parsed.createdAt = {type: Date, required: true, default: Date.now};
        parsed.updatedAt = Date;
        parsed.deletedAt = Date;

        return parsed;
    }

    // Convert Origami resource to MongoDB resource
    private _convertTo(
        resource: Origami.Store.Resource | Origami.Store.Resource[]
    ): MongoDocument | MongoDocument[] {

        if (resource instanceof Array) {
            return resource.map(
                r => this._convertTo(r) as MongoDocument
            );
        }

        const r = resource as MongoDocument;
        if (resource.id) r._id = resource.id;
        delete r.id;

        return resource as MongoDocument;
    }


    // Convert MongoDB resource to Origami resource
    private _convertFrom(
        resource: MongoDocumentWithPlugins | MongoDocumentWithPlugins[],
        opts: toJSONHidden = {},
        children = false
    ): Origami.Store.Resource | Origami.Store.Resource[] | null {

        if (resource instanceof Array) {
            return resource.map((r: MongoDocumentWithPlugins) =>
                this._convertFrom(r, opts, children) as Origami.Store.Resource
            );
        }
        if (!resource) return null;

        const r = (resource.toJSONHidden
            ? resource.toJSONHidden(opts)
            : resource) as MongoDocumentWithPlugins;

        const convert: Origami.Store.Resource = r;
        // If the resource has children, and the paramater is set, loop over
        // children and apply the function recursively.
        if (r.children && children) {
            delete (convert as MongoDocumentWithPlugins).path;
            delete (convert as MongoDocumentWithPlugins).parent;
            const c = this._convertFrom(r.children, opts, true);
            if (c instanceof Array) convert.children = c;
            else if (c) convert.children = [c];
        }

        convert.id = r._id;
        delete (convert as MongoDocumentWithPlugins)._id;
        delete (convert as MongoDocumentWithPlugins).__v;

        return r;
    }

    // Query for resources
    async find(query = {}, opts = {}) {
        // If there is an id specified, then find one, otherwise query all
        let q = query as Origami.Store.Resource;
        let func = 'find';
        if (q) {
            if (q.id) func = 'findOne';
            q = this._convertTo(q) as Origami.Store.Resource;
            q.deletedAt = null;
        } else q = {deletedAt: null};

        return this._convertFrom(
            await (this._model[func as keyof mongoose.Model<any>] as Function)(q),
            opts
        );
    }

    // Create a new resource
    async create(resource: Origami.Store.Resource) {
        try {
            return this._convertFrom(await this._model.create(resource));
        } catch (e) {
            this._handleError(e);
        }
    }

    // Update a resource based on the id or query
    update(idOrObj: string | object, resource: Origami.Store.Resource, opts = {}) {
        return this._updateResource(idOrObj, resource, opts);
    }

    // Delete a resource
    async delete(idOrObj: string | object, resource: Origami.Store.Resource, opts = {}) {
        await this._updateResource(idOrObj, {deletedAt: new Date()}, opts);

        return true;
    }

    // Move a resource under a parent in the tree
    async move(id: string, parentId: string) {
        if (!this._isTree) throw new Error('Modal is not a tree structure');

        const res = await this._model.findById(id);
        if (!res) throw new Error('Resource does not exist');

        const parent = await this._model.findById(parentId);
        if (!parent) {
            throw new Error('Could not move resource. Parent does not exist');
        }


        if (parent.path) {
            if (parent.path.includes(id)) {
                throw new Error(
                    'Could not move resource. Parent is an existing child of the resource.'
                );
            }
        } else {
            parent.path = parent._id;
            await parent.save();
        }

        res.parent = parent;

        return res.save();
    }


    // Get the tree of descendants
    async children(
        id: string, fields: string[] | true = []
    ): Promise<Origami.Store.Resource | Origami.Store.Resource[] | false> {

        if (!this._isTree) throw new Error('Modal is not a tree structure');
        const f = fields;

        const res = await this._model.findById(id);
        if (!res) throw new Error('Resource does not exist');

        let _f: string | null;

        if (f === true) {
            // Set to null so all fields are included
            _f = null;
        } else {
            f.unshift('_id');
            _f = f.join(' ');
        }

        return new Promise((_res, rej) => {
            res.getChildrenTree({fields: f}, (err: Error, tree: MongoDocumentWithPlugins) => {
                if (err) rej(err);
                const convert = this._convertFrom(tree, {}, true);
                if (convert) _res(convert);
                else _res(false);
            });
        });
    }


    // Get the tree of descendants
    async parent(
        id: string
    ): Promise<Origami.Store.Resource | false > {

        if (!this._isTree) throw new Error('Modal is not a tree structure');

        const res = await this._model.findById(id);
        if (!res) throw new Error('Resource does not exist');

        return new Promise((_res, rej) => {
            res.getParent((err: Error, parent: MongoDocumentWithPlugins) => {
                if (err) rej(err);
                const convert = this._convertFrom(parent, {}, true);
                if (convert) _res(convert);
                else _res(false);
            });
        });
    }

    private _handleError(e: Error) {
        const errDuplicate1 = 11000;
        const errDuplicate2 = 11001;

        interface errorWithCode extends Error {
            code: number;
        }
        switch ((e as errorWithCode).code) {
            // Handle duplicate errors
            case errDuplicate1:
            case errDuplicate2:
                let [field] = e.message.split(' dup key');
                field = field
                    .substring(0, field.lastIndexOf('_'))
                    .split(' ')
                    .pop() as string;

                const err = new Error('request.invalid') as Origami.Server.DataError;
                err.data = [
                    {
                        type: 'store',
                        field,
                        rule: 'duplicate'
                    }
                ];
                throw err;
            default:
                throw e;
        }
    }

    // Modifies a resource. EG update, or delete (set the deleted flag)
    private async _updateResource(idOrObj: string | object, $set: object, opts: object, convert = true) {
        let query = {} as Query;
        if ((typeof idOrObj === 'string') && uuidValidate(idOrObj)) {
            query._id = idOrObj;
        } else query = idOrObj as Query;
        query.deletedAt = null;

        let updatedResource;
        try {
            updatedResource = await this._model.findOneAndUpdate(
                query,
                {$set},
                {new: true}
            );
        } catch (e) {
            return this._handleError(e);
        }
        if (!updatedResource) throw new Error('general.errors.notFound');

        return convert
            ? this._convertFrom(updatedResource, opts)
            : updatedResource;
    }
}
