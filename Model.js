const mongoose = require('mongoose');
const uuid = require('uuid/v4');
const uuidValidate = require('uuid-validate');

const {
    symbols
} = require('origami-core-lib');

const s = symbols([
    // Props
    'schema',
    'schemaObj',
    'model',
    // Methods
    'parseFrom',
    'parseTo',
    'addMethods',

    'convertTo',
    'convertFrom',
    'handleError',
    'updateResource'
]);

module.exports = class Model {
    constructor(name, schema) {
        this.name = name;
        this[s.schemaObj] = schema;
        this[s.schema] = new mongoose.Schema(this[s.parseFrom](schema));

        // Update .toJSONHidden method on schema to remove hidden fields
        this[s.addMethods]();


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
            if (typeof prop === 'string') prop = {
                type: prop
            };
            if (pName === 'id') pName = '_id';

            parsed[pName] = prop;

            if (prop.type instanceof Array) {
                parsed[pName].type = mongoose.Schema.Types.Mixed;
            } else switch (prop.type) {
                case 'email':
                    parsed[pName].type = String;
                    break;
                case 'uuid':
                    parsed[pName].type = String;
                    parsed[pName].default = () => uuid();
                    break;
                }

            if (prop.unique) {
                parsed[pName].index = {
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
    [s.convertTo](resource, opts) {
        if (resource instanceof Array) return resource.map(this[s.convertTo]);
        if (resource.id) resource._id = resource.id;
        delete resource.id;

        return resource;
    }


    // Convert MongoDB resource to Origami resource
    [s.convertFrom](resource, opts = {}) {
        if (resource instanceof Array) return resource.map(r => this[s.convertFrom](r, opts));
        if (!resource) return null;

        const r = resource.toJSONHidden(opts);

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

        return this[s.convertFrom](
            await this[s.model][func](q),
            opts
        );
    }


    // Create a new resource
    async create(resource) {
        try {
            return this[s.convertFrom](
                await this[s.model].create(resource)
            );
        } catch (e) {
            this[s.handleError](e);
        }
    }

    // Update a resource based on the id or query
    update(idOrObj, resource, opts = {}) {
        return this[s.updateResource](idOrObj, resource, opts);
    }

    async delete(idOrObj, resource, opts = {}) {
        await this[s.updateResource](idOrObj, {deletedAt: new Date()}, opts);

        return true;
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
                err.data = [{
                    type: 'store',
                    field,
                    rule: 'duplicate'
                }];
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
            updatedResource = await this[s.model]
                .findOneAndUpdate(
                    query,
                    {$set},
                    {new: true}
                );
        } catch (e) {
            return this[s.handleError](e);
        }
        if (!updatedResource) throw new Error('general.errors.notFound');

        return convert ? this[s.convertFrom](updatedResource, opts) : updatedResource;
    }
};
