import { Origami } from 'origami-core-lib';
export default class Model implements Origami.Store.Model {
    name: string;
    private _schemaObj;
    private _schema;
    private _isTree;
    private _model;
    constructor(name: string, schema: Origami.Store.Schema);
    readonly hiddenFields: string[];
    private _addMethods();
    private _parseFrom(schema);
    private _convertTo(resource);
    private _convertFrom(resource, opts?, children?);
    find(query?: {}, opts?: {}): Promise<Origami.Store.Resource | Origami.Store.Resource[] | null>;
    create(resource: Origami.Store.Resource): Promise<Origami.Store.Resource | Origami.Store.Resource[] | null | undefined>;
    update(idOrObj: string | object, resource: Origami.Store.Resource, opts?: {}): Promise<any>;
    delete(idOrObj: string | object, resource: Origami.Store.Resource, opts?: {}): Promise<boolean>;
    move(id: string, parentId: string): Promise<any>;
    children(id: string, fields?: string[] | true): Promise<Origami.Store.Resource | Origami.Store.Resource[] | false>;
    parent(id: string): Promise<Origami.Store.Resource | false>;
    private _handleError(e);
    private _updateResource(idOrObj, $set, opts, convert?);
}
