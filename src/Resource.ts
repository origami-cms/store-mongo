import {Origami} from 'origami-core-lib';
import {Resource} from 'origami-store-base';
import {MongoDocumentWithPlugins, MongoDocument} from './Model';

export default class MongoResource extends Resource {
    // @ts-ignore
    protected _originalResource: MongoDocumentWithPlugins;
    protected _converted?: Origami.Store.Resource;

    constructor(type: string, resource: any, store: Origami.Store.Store, opts = {}) {
        super(type, resource, store, opts);
    }

    async save() {
        await this._originalResource!.save();
        return this;
    }

    async delete() {
        await this._originalResource!.remove();
        return null;
    }


    protected _convertTo(resource: MongoDocumentWithPlugins, opts: object) {
        let r: object = resource;

        if (resource.toJSONHidden) r = resource.toJSONHidden(opts);

        const convert: Origami.Store.Resource = r;

        convert.id = (r as MongoDocument)._id;
        delete (convert as MongoDocumentWithPlugins)._id;
        delete (convert as MongoDocumentWithPlugins).__v;

        return r;
    }

    protected _convertNested(opts?: any) {
        Object.entries(this._linkedResources).forEach(([prop, resName]) => {
            const p = prop as keyof this;
            if (this[p] instanceof Array) {
                this[p] = (this[p] as object[]).map(
                    r => new MongoResource(resName, r, this._store, opts)
                );
            }
            else this[p] = new MongoResource(resName, this[p], this._store, opts);
        });
    }
}
