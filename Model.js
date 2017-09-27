const mongoose = require('mongoose');
const uuid = require('uuid/v4');
const {symbols} = require('origami-core-lib');


const s = symbols([
    // Props
    'schema',
    'model',
    // Methods
    'parseFrom',
    'parseTo'
]);


module.exports = class Model {
    constructor(name, schema) {
        this.name = name;
        this[s.schema] = new mongoose.Schema(this[s.parseFrom](schema));
        this[s.model] = mongoose.model(name, this[s.schema]);
    }

    // Parse the schema from Origami standard to Mongoose standard
    [s.parseFrom](schema) {
        const parsed = {};
        Object.entries(schema.properties).forEach(([pName, prop]) => {
            let name = pName;
            if (pName == 'id') name = '_id';

            if (typeof prop === 'string') prop = {type: prop};

            parsed[pName] = prop;

            switch(prop.type) {
                case 'email':
                    parsed[pName].type = String
                    break;
                case 'uuid':
                    parsed[pName].type = String
                    parsed[pName].default = () => uuid();
                    break;
            }
        });

        return parsed;
    }

    async find(query) {
        return await this[s.model].find(query);
    }

    async create(resource) {
        return await this[s.model].create(resource);
    }
}
