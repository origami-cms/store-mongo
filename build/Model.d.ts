import mongoose from 'mongoose';
import { Origami } from 'origami-core-lib';
import { Model } from 'origami-store-base';
import Resource from './Resource';
export interface toJSONHidden {
    hidden?: boolean;
}
export interface MongoDocument {
    _id: any;
    deletedAt?: Date | null;
    [key: string]: any;
}
export interface MongoDocumentWithPlugins extends MongoDocument, mongoose.Document {
    toJSONHidden(opts: toJSONHidden): object;
    children?: MongoDocumentWithPlugins[];
}
export default class MongoModel extends Model {
    private _mSchema;
    private _mModel;
    constructor(name: string, schema: Origami.Store.Schema, store: Origami.Store.Store);
    private _addMethods;
    protected _create(resource: object, options?: object): Promise<Resource | null>;
    protected _find(query: object, options?: {
        [key: string]: any;
    }): Promise<Resource[]>;
    protected _findOne(query: object, options?: object): Promise<Resource | null>;
    protected _update(query: object, newResource: {
        [key: string]: any;
    }, options?: any): Promise<(Resource | null)[]>;
    protected _schemaFrom(schema: Origami.Store.Schema): {
        [key: string]: any;
    };
    protected _resourceFrom(resource: Origami.Store.Resource): object;
    private _handleError;
    private _addValidators;
    private _populateQuery;
    private _parseQuery;
}
