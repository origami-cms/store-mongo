import mongoose, {SchemaDefinition, Schema} from 'mongoose';
import {Origami} from 'origami-core-lib';
import {Model} from 'origami-store-base';
import Resource from './Resource';
import uuid from 'uuid/v4';
import {singular} from 'pluralize';
import clone from 'clone';
interface toJSONHidden { hidden?: boolean; }


interface MongoDocument {
    _id: any;
    deletedAt?: Date | null;
    [key: string]: any;
}


export interface MongoDocumentWithPlugins extends MongoDocument, mongoose.Document {
    toJSONHidden(opts: toJSONHidden): object;
    children?: MongoDocumentWithPlugins[];
}

mongoose.Promise = global.Promise;
export default class MongoModel extends Model {
    private _mSchema: Schema;
    private _mModel: mongoose.Model<any>;

    constructor(name: string, schema: Origami.Store.Schema, store: Origami.Store.Store) {
        super(name, schema, store);

        this._mSchema = new mongoose.Schema(
            this._schemaFrom(schema) as SchemaDefinition,
            {emitIndexErrors: true}
        );

        this._addValidators();

        // Update .toJSONHidden method on schema to remove hidden fields
        this._addMethods();

        this._mModel = mongoose.model(name, this._mSchema);

    }


    private _addMethods() {
        const hidden = this.hiddenFields;

        // Remove the hidden fields from the result
        this._mSchema.methods.toJSONHidden = function toJSONHidden(opts: toJSONHidden) {
            const obj = this.toObject();
            if (opts.hidden !== true) hidden.forEach(f => delete obj[f]);
            return obj;
        };
    }


    protected async _create(resource: object, options?: object) {
        try {
            return new Resource(
                this.name,
                await this._mModel.create(resource),
                this.store,
                options
            );

        } catch (e) {
            this._handleError(e);
        }
    }


    protected async _find(
        query: object,
        options?: { [key: string]: any }
    ): Promise<Resource[]> {
        this._parseQuery(query);
        let func = this._mModel.find(query);
        func = this._populateQuery(func, options);

        return (await func).map(r => new Resource(this.name, r, this.store, options));
    }


    protected async _findOne(query: object, options?: object): Promise<Resource | null> {
        this._parseQuery(query);
        let func = this._mModel.findOne(query);
        func = this._populateQuery(func, options);

        const res = await func;
        if (!res) return null;
        return new Resource(this.name, res, this.store, options);
    }


    protected async _update(
        query: object,
        newResource: { [key: string]: any },
        options?: any
    ): Promise<(Resource | null)[]> {
        const updateOptions: mongoose.ModelUpdateOptions = {new: true, multi: true};
        if (options && options.upsert) {
            updateOptions.upsert = true;
            updateOptions.setDefaultsOnInsert = true;
            newResource.$setOnInsert = {
                _id: uuid()
            };
        }

        const toUpdate = await this._mModel.find(this._parseQuery(query));

        if (!toUpdate.length && options.upsert) {
            const created = await this._create({...query, ...newResource});
            if (created) return [created];
            return [];
        }

        return await Promise.all(
            toUpdate.map(doc => new Promise<Resource | null>(async res => {
                await doc.set(newResource);
                await doc.save();
                if (doc.deletedAt) return res(null);

                const r = await new Resource(this.name, doc, this.store, options);
                res(r);
            }))
        );


        // const res = await this._mModel.update(
        //     query,
        //     newResource,
        //     // Returns the updated resource, not the old one
        //     updateOptions
        // );


        // return new Resource(this.name,
        //     res,
        //     this.store,
        //     options
        // );
    }


    protected _schemaFrom(schema: Origami.Store.Schema) {
        const cloned = clone(schema);
        const parsed: { [key: string]: any } = {};

        Object.entries(cloned.properties).forEach(([pName, prop]) => {
            const isA = Boolean(prop.isA);
            const isMany = Boolean(prop.isMany);

            let p = prop;
            let name = pName;

            if (typeof p === 'string' || p instanceof Array) p = {type: p};
            if (name === 'id') name = '_id';

            if (isA) {
                p.ref = p.isA;
                delete p.isA;
                p.type = 'uuid';
            }
            if (isMany) {
                p.ref = p.isMany;
                delete p.isMany;
                p.type = 'uuid';
            }

            if (p.type instanceof Array) {
                p.type = mongoose.Schema.Types.Mixed;
            } else {
                switch (p.type) {
                    case 'email':
                        p.type = String;
                        break;
                    case 'uuid':
                        p.type = String;
                        if (!p.default) p.default = () => uuid();
                        break;
                }
            }

            if (p.unique) {
                p.index = {
                    unique: true
                };
            }

            if (isMany) {
                p = [p];
            }

            parsed[name] = p;
        });

        parsed.createdAt = {type: Date, required: true, default: Date.now};
        parsed.updatedAt = {type: Date, default: null};
        parsed.deletedAt = {type: Date, default: null};

        return parsed;
    }


    protected _resourceFrom(resource: Origami.Store.Resource): object {
        const r = resource as MongoDocument;
        if (resource.id) r._id = resource.id;
        delete r.id;

        return resource as MongoDocument;
    }


    private _handleError(e: Error) {
        const fieldRegex = /.+Path `(.+)`/;
        const validateMessages = this._validateMessages;

        const rules: { [field: string]: [RegExp, Function] } = {
            required: [
                /.+Path `(.+)` is required/,
                validateMessages.required
            ],
            min: [
                /.+Path `(.+)` \((.+)\) is less than minimum allowed value \((.+)\)/,
                validateMessages.min
            ],
            max: [
                /.+Path `(.+)` \((.+)\) is more than maximum allowed value \((.+)\)/,
                validateMessages.max
            ],
            minLength: [
                /.+Path `(.+)` \(`(.+)`\) is shorter than the minimum allowed length \((.+)\)/,
                validateMessages.minLength
            ],
            maxLength: [
                /.+Path `(.+)` \(`(.+)`\) is longer than the maximum allowed length \((.+)\)/,
                validateMessages.maxLength
            ]
        };


        interface errorWithCode extends Error {
            code: number;
        }


        // Custom duplicate code
        const errDuplicate1 = 11000;
        const errDuplicate2 = 11001;
        if (
            (e as errorWithCode).code === errDuplicate1 ||
            (e as errorWithCode).code === errDuplicate2
        ) {
            let [field] = e.message.split(' dup key');
            field = field
                .substring(0, field.lastIndexOf('_'))
                .split(' ')
                .pop() as string;

            return this._validationError(
                this._validateMessages.duplicate(field),
                field,
                'duplicate'
            );
        }


        // Loop over all the rules and find the right error
        Object.entries(rules).forEach(([rule, [r, func]]) => {
            if (r.test(e.message)) {
                this._validationError(
                    func(...r.exec(e.message)!.slice(1)),
                    rule,
                    fieldRegex.exec(e.message)![1]
                );
            }
        });


        // Throw the default error
        throw e;
    }


    private _addValidators() {
        Object.entries(this._mSchema.obj).forEach(([name, prop]: [string, any]) => {
            // Validate {ref: 'xxx'} by looking up the model,
            // and finding the resource with that ID
            if (prop.ref) {
                const parent = prop.ref;
                const singularP = singular(parent);
                const upper = singularP[0].toUpperCase() + singularP.slice(1);

                this._mSchema.path(name).validate(
                    // TODO: Ensure not deleted
                    (id: string) => mongoose.models[parent].findById(id),
                    `${upper} does not exist with that ID`
                );
            }
        });
    }


    private _populateQuery(func: mongoose.DocumentQuery<any, any>, options: any) {
        let f = func;

        if (options && options.include) {
            let include: string[] = [];
            if (typeof options.include === 'string') include = [options.include];
            else if (options.include instanceof Array) include = options.include;

            include.forEach(field => {
                f = f.populate(field);
            });
            if (include.length) f = f.exec();
        }

        return func;
    }

    private _parseQuery(query: object) {
        query.deletedAt = null;
        return query;
    }
}
