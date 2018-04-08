"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const mpathPlugin = require('mongoose-mpath');
const v4_1 = __importDefault(require("uuid/v4"));
const uuid_validate_1 = __importDefault(require("uuid-validate"));
const PLUGIN_TREE_OPTIONS = {
    pathSeparator: '#',
    onDelete: 'REPARENT',
    idType: String // Type used for model id
};
class Model {
    constructor(name, schema) {
        this._isTree = false;
        this.name = name;
        this._schemaObj = schema;
        this._schema = new mongoose_1.default.Schema(this._parseFrom(schema));
        // Update .toJSONHidden method on schema to remove hidden fields
        this._addMethods();
        if (schema.tree) {
            this._isTree = true;
            this._schema.plugin(mpathPlugin, PLUGIN_TREE_OPTIONS);
        }
        this._model = mongoose_1.default.model(name, this._schema);
    }
    // List of properties that have `hidden: true` in the schema
    get hiddenFields() {
        return Object.entries(this._schemaObj.properties)
            .map(([name, prop]) => {
            if (prop.hidden === true)
                return name;
        })
            .filter(n => n);
    }
    _addMethods() {
        const hidden = this.hiddenFields;
        // Remove the hidden fields from the result
        this._schema.methods.toJSONHidden = function toJSONHidden(opts) {
            const obj = this.toObject();
            if (opts.hidden !== true)
                hidden.forEach(f => delete obj[f]);
            return obj;
        };
    }
    // Parse the schema from Origami standard to Mongoose standard
    _parseFrom(schema) {
        const parsed = {};
        Object.entries(schema.properties).forEach(([pName, prop]) => {
            let p = prop;
            let name = pName;
            if (typeof p === 'string') {
                p = {
                    type: p
                };
            }
            if (name === 'id')
                name = '_id';
            parsed[name] = p;
            if (p.type instanceof Array) {
                parsed[name].type = mongoose_1.default.Schema.Types.Mixed;
            }
            else {
                switch (p.type) {
                    case 'email':
                        parsed[name].type = String;
                        break;
                    case 'uuid':
                        parsed[name].type = String;
                        parsed[name].default = () => v4_1.default();
                        break;
                }
            }
            if (p.unique) {
                parsed[name].index = {
                    unique: true
                };
            }
        });
        parsed.createdAt = { type: Date, required: true, default: Date.now };
        parsed.updatedAt = Date;
        parsed.deletedAt = Date;
        return parsed;
    }
    // Convert Origami resource to MongoDB resource
    _convertTo(resource) {
        if (resource instanceof Array) {
            return resource.map(r => this._convertTo(r));
        }
        const r = resource;
        if (resource.id)
            r._id = resource.id;
        delete r.id;
        return resource;
    }
    // Convert MongoDB resource to Origami resource
    _convertFrom(resource, opts = {}, children = false) {
        if (resource instanceof Array) {
            return resource.map((r) => this._convertFrom(r, opts, children));
        }
        if (!resource)
            return null;
        const r = (resource.toJSONHidden
            ? resource.toJSONHidden(opts)
            : resource);
        const convert = r;
        // If the resource has children, and the paramater is set, loop over
        // children and apply the function recursively.
        if (r.children && children) {
            delete convert.path;
            delete convert.parent;
            const c = this._convertFrom(r.children, opts, true);
            if (c instanceof Array)
                convert.children = c;
            else if (c)
                convert.children = [c];
        }
        convert.id = r._id;
        delete convert._id;
        delete convert.__v;
        return r;
    }
    // Query for resources
    async find(query = {}, opts = {}) {
        // If there is an id specified, then find one, otherwise query all
        let q = query;
        let func = 'find';
        if (q) {
            if (q.id)
                func = 'findOne';
            q = this._convertTo(q);
            q.deletedAt = null;
        }
        else
            q = { deletedAt: null };
        return this._convertFrom(await this._model[func](q), opts);
    }
    // Create a new resource
    async create(resource) {
        try {
            return this._convertFrom(await this._model.create(resource));
        }
        catch (e) {
            this._handleError(e);
        }
    }
    // Update a resource based on the id or query
    update(idOrObj, resource, opts = {}) {
        return this._updateResource(idOrObj, resource, opts);
    }
    // Delete a resource
    async delete(idOrObj, resource, opts = {}) {
        await this._updateResource(idOrObj, { deletedAt: new Date() }, opts);
        return true;
    }
    // Move a resource under a parent in the tree
    async move(id, parentId) {
        if (!this._isTree)
            throw new Error('Modal is not a tree structure');
        const res = await this._model.findById(id);
        if (!res)
            throw new Error('Resource does not exist');
        const parent = await this._model.findById(parentId);
        if (!parent) {
            throw new Error('Could not move resource. Parent does not exist');
        }
        if (parent.path) {
            if (parent.path.includes(id)) {
                throw new Error('Could not move resource. Parent is an existing child of the resource.');
            }
        }
        else {
            parent.path = parent._id;
            await parent.save();
        }
        res.parent = parent;
        return res.save();
    }
    // Get the tree of descendants
    async children(id, fields = []) {
        if (!this._isTree)
            throw new Error('Modal is not a tree structure');
        const f = fields;
        const res = await this._model.findById(id);
        if (!res)
            throw new Error('Resource does not exist');
        let _f;
        if (f === true) {
            // Set to null so all fields are included
            _f = null;
        }
        else {
            f.unshift('_id');
            _f = f.join(' ');
        }
        return new Promise((_res, rej) => {
            res.getChildrenTree({ fields: f }, (err, tree) => {
                if (err)
                    rej(err);
                const convert = this._convertFrom(tree, {}, true);
                if (convert)
                    _res(convert);
                else
                    _res(false);
            });
        });
    }
    // Get the tree of descendants
    async parent(id) {
        if (!this._isTree)
            throw new Error('Modal is not a tree structure');
        const res = await this._model.findById(id);
        if (!res)
            throw new Error('Resource does not exist');
        return new Promise((_res, rej) => {
            res.getParent((err, parent) => {
                if (err)
                    rej(err);
                const convert = this._convertFrom(parent, {}, true);
                if (convert)
                    _res(convert);
                else
                    _res(false);
            });
        });
    }
    _handleError(e) {
        const errDuplicate1 = 11000;
        const errDuplicate2 = 11001;
        switch (e.code) {
            // Handle duplicate errors
            case errDuplicate1:
            case errDuplicate2:
                let [field] = e.message.split(' dup key');
                field = field
                    .substring(0, field.lastIndexOf('_'))
                    .split(' ')
                    .pop();
                const err = new Error('request.invalid');
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
    async _updateResource(idOrObj, $set, opts, convert = true) {
        let query = {};
        if ((typeof idOrObj === 'string') && uuid_validate_1.default(idOrObj)) {
            query._id = idOrObj;
        }
        else
            query = idOrObj;
        query.deletedAt = null;
        let updatedResource;
        try {
            updatedResource = await this._model.findOneAndUpdate(query, { $set }, { new: true });
        }
        catch (e) {
            return this._handleError(e);
        }
        if (!updatedResource)
            throw new Error('general.errors.notFound');
        return convert
            ? this._convertFrom(updatedResource, opts)
            : updatedResource;
    }
}
exports.default = Model;
