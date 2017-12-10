const mongoose = require('mongoose');
const MpathPlugin = require('mongoose-mpath');
const uuid = require('uuid/v4');
const uuidValidate = require('uuid-validate');

const {symbols} = require('origami-core-lib');

const s = symbols([
    // Props
    'schema',
    'schemaObj',
    'model',
    'isTree',
    // Methods
    'parseFrom',
    'parseTo',
    'addMethods',

    'convertTo',
    'convertFrom',
    'handleError',
    'updateResource'
]);

const PLUGIN_TREE_OPTIONS = {
    pathSeparator: '#', // String used to separate ids in path
    onDelete: 'REPARENT', // 'REPARENT' or 'DELETE'
    idType: String // Type used for model id
};

module.exports = class Model {
    constructor(name, schema) {
        this.name = name;
        this[s.schemaObj] = schema;
        this[s.schema] = new mongoose.Schema(this[s.parseFrom](schema));

        // Update .toJSONHidden method on schema to remove hidden fields
        this[s.addMethods]();

        if (schema.tree) {
            this[s.isTree] = true;
            this[s.schema].plugin(MpathPlugin, PLUGIN_TREE_OPTIONS);
        }

        this[s.model] = mongoose.model(name, this[s.schema]);
    }

    // List of properties that have `hidden: true` in the schema
    get hiddenFields() {
        return Object.entries(this[s.schemaObj].properties)
            .map(([name, prop]) => {
                if (prop.hidden === true) return name;
            })
            .filter(n => n);
    }

    [s.addMethods]() {
        const {hiddenFields} = this;

        // Remove the hidden fields from the result
        this[s.schema].methods.toJSONHidden = function toJSONHidden(opts) {
            const obj = this.toObject();

            if (opts.hidden != true) hiddenFields.forEach(f => delete obj[f]);

            return obj;
        };
    }

    // Parse the schema from Origami standard to Mongoose standard
    [s.parseFrom](schema) {
        const parsed = {};
        Object.entries(schema.properties).forEach(([pName, prop]) => {
            let p = prop;
            let name = pName;
            if (typeof p === 'string')
                p = {
                    type: p
                };
            if (name === 'id') name = '_id';

            parsed[name] = p;

            if (p.type instanceof Array) {
                parsed[name].type = mongoose.Schema.Types.Mixed;
            } else
                switch (p.type) {
                    case 'email':
                        parsed[name].type = String;
                        break;
                    case 'uuid':
                        parsed[name].type = String;
                        parsed[name].default = () => uuid();
                        break;
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
    [s.convertTo](resource) {
        if (resource instanceof Array) return resource.map(this[s.convertTo]);
        if (resource.id) resource._id = resource.id;
        delete resource.id;

        return resource;
    }

    // Convert MongoDB resource to Origami resource
    [s.convertFrom](resource, opts = {}, children = false) {
        if (resource instanceof Array)
            return resource.map(r => this[s.convertFrom](r, opts, children));
        if (!resource) return null;

        const r = resource.toJSONHidden
            ? resource.toJSONHidden(opts)
            : resource;

        // If the resource has children, and the paramater is set, loop over
        // children and apply the function recursively.
        if (r.children && children) {
            delete r.path;
            delete r.parent;
            r.children = this[s.convertFrom](r.children, opts, true);
            if (!r.children.length) delete r.children;
        }

        r.id = r._id;
        delete r._id;
        delete r.__v;

        return r;
    }

    // Query for resources
    async find(query = {}, opts = {}) {
        // If there is an id specified, then find one, otherwise query all
        let q = query;
        let func = 'find';
        if (q) {
            if (q.id) func = 'findOne';
            q = this[s.convertTo](q);
            q.deletedAt = null;
        } else q = {deletedAt: null};

        return this[s.convertFrom](await this[s.model][func](q), opts);
    }

    // Create a new resource
    async create(resource) {
        try {
            return this[s.convertFrom](await this[s.model].create(resource));
        } catch (e) {
            this[s.handleError](e);
        }
    }

    // Update a resource based on the id or query
    update(idOrObj, resource, opts = {}) {
        return this[s.updateResource](idOrObj, resource, opts);
    }

    // Delete a resource
    async delete(idOrObj, resource, opts = {}) {
        await this[s.updateResource](idOrObj, {deletedAt: new Date()}, opts);

        return true;
    }

    // Move a resource under a parent in the tree
    async move(id, parentId) {
        if (!this[s.isTree]) throw new Error('Modal is not a tree structure');

        const res = await this[s.model].findById(id);
        if (!res) throw new Error('Resource does not exist');

        const parent = await this[s.model].findById(parentId);
        if (!parent)
            throw new Error('Could not move resource. Parent does not exist');


        if (parent.path) {
            if (parent.path.includes(id))
                throw new Error(
                    'Could not move resource. Parent is an existing child of the resource.'
                );
        } else {
            parent.path = parent._id;
            await parent.save();
        }

        res.parent = parent;

        return res.save();
    }

    // Get the tree of descendants
    async children(id, fields = []) {
        if (!this[s.isTree]) throw new Error('Modal is not a tree structure');
        let f = fields;

        const res = await this[s.model].findById(id);
        if (!res) throw new Error('Resource does not exist');

        if (f === true) {
            // Set to null so all fields are included
            f = null;
        } else {
            f.unshift('_id');
            f = f.join(' ');
        }

        return new Promise((_res, rej) => {
            res.getChildrenTree({fields: f}, (err, tree) => {
                if (err) rej(err);
                else _res(this[s.convertFrom](tree, {}, true));
            });
        });
    }


    // Get the tree of descendants
    async parent(id) {
        if (!this[s.isTree]) throw new Error('Modal is not a tree structure');

        const res = await this[s.model].findById(id);
        if (!res) throw new Error('Resource does not exist');

        return new Promise((_res, rej) => {
            res.getParent((err, parent) => {
                if (err) rej(err);
                else _res(this[s.convertFrom](parent, {}));
            });
        });
    }

    [s.handleError](e) {
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
    async [s.updateResource](idOrObj, $set, opts, convert = true) {
        let query = {};
        if (uuidValidate(idOrObj)) {
            query._id = idOrObj;
        } else query = idOrObj;
        query.deletedAt = null;

        let updatedResource;
        try {
            updatedResource = await this[s.model].findOneAndUpdate(
                query,
                {$set},
                {new: true}
            );
        } catch (e) {
            return this[s.handleError](e);
        }
        if (!updatedResource) throw new Error('general.errors.notFound');

        return convert
            ? this[s.convertFrom](updatedResource, opts)
            : updatedResource;
    }
};
