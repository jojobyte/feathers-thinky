import Proto from 'uberproto';
import filter from 'feathers-query-filters';
import errors from 'feathers-errors';
import { _, select } from 'feathers-commons';
import { createFilter } from './parse';

const BASE_EVENTS = ['created', 'updated', 'patched', 'removed'];

// Create the service.
class Service {
  constructor (options) {
    if (!options) {
      throw new Error('RethinkDB options have to be provided.');
    }

    if (!options.Model) {
      throw new Error('You must provide the RethinkDB object on options.Model');
    }

    // Make sure the user connected a database before creating the service.
    if (!options.Model._thinky.r._poolMaster._options.db) {
      throw new Error('You must provide either an instance of r that is preconfigured with a db, or a provide options.db.');
    }

    this.type = 'rethinkdb';
    this.Model = options.Model;
    this.id = this.Model._pk;
    this.watch = options.watch !== undefined ? options.watch : true;
    this.paginate = options.paginate || {};
    this.events = this.watch ? BASE_EVENTS.concat(options.events) : options.events || [];
  }

  extend (obj) {
    return Proto.extend(obj, this);
  }

  init () {
    let r = this.Model._thinky.r;
    return r.dbList().contains(r._poolMaster._options.db).then(() => {
      return r.db(r._poolMaster._options.db).tableList().contains(this.Model.getTableName());
    });
  }

  createFilter (query) {
    return createFilter(query, this.Model._thinky.r);
  }

  createQuery (originalQuery) {
    const { filters, query } = filter(originalQuery || {});
    let rq = this.Model.filter(this.createFilter(query));

    // Handle $select
    if (filters.$select) {
      rq = rq.pluck(filters.$select);
    }

    // Handle $sort
    if (filters.$sort) {
      _.each(filters.$sort, (order, fieldName) => {
        if (parseInt(order) === 1) {
          rq = rq.orderBy(fieldName);
        } else {
          let r = this.Model._thinky.r;
          rq = rq.orderBy(r.desc(fieldName));
        }
      });
    }

    return rq;
  }

  _find (params = {}) {
    const paginate = typeof params.paginate !== 'undefined' ? params.paginate : this.paginate;
    // Prepare the special query params.
    const { filters } = filter(params.query || {}, paginate);

    let q = params.rethinkdb || this.createQuery(params.query);
    let countQuery;

    // For pagination, count has to run as a separate query, but without limit.
    if (paginate.default) {
      countQuery = q.count().execute();
    }

    // Handle $skip AFTER the count query but BEFORE $limit.
    if (filters.$skip) {
      q = q.skip(filters.$skip);
    }
    // Handle $limit AFTER the count query and $skip.
    if (typeof filters.$limit !== 'undefined') {
      q = q.limit(filters.$limit);
    }

    // Execute the query
    return Promise.all([q, countQuery]).then(([data, total]) => {
      if (paginate.default) {
        return {
          total,
          data,
          limit: filters.$limit,
          skip: filters.$skip || 0
        };
      }

      return data;
    });
  }

  find (...args) {
    return this._find(...args);
  }

  _get (id, params = {}) {
    let query;
    // If an id was passed, just get the record.
    if (id !== null && id !== undefined) {
      query = this.Model.get(id);
    } else {
      query = this.Model.filter(params.query).limit(1);
    }

    if (params.query && params.query.$select) {
      query = query.pluck(params.query.$select.concat(this.id));
    }

    return query.run().then(data => {
      if (Array.isArray(data)) {
        data = data[0];
      }
      return data;
    }).catch(function () {
      throw new errors.NotFound(`No record found for id '${id}'`);
    });
  }

  get (...args) {
    return this._get(...args);
  }

  create (data, params) {
    const idField = this.id;
    return this.Model.save(data).then(res => {
      if (data[idField]) {
        if (res.errors) {
          return Promise.reject(new errors.Conflict('Duplicate primary key', res.errors));
        }
        return data;
      } else { // add generated id
        const addId = (current, index) => {
          if (res.generated_keys && res.generated_keys[index]) {
            return Object.assign({}, current, {
              [idField]: res.generated_keys[index]
            });
          }

          return current;
        };

        if (Array.isArray(data)) {
          return data.map(addId);
        }

        return addId(data, 0);
      }
    }).then(select(params, this.id));
  }

  _patch (id, data, params) {
    return this._get(id, params)
      .then((found) => {
        return found.merge(data).save().then(function (response) {
          return response;
        });
      });
  }

  patch (id, data, params) {
    if (id === null) {
      return this._find(params).then(page => {
        return Promise.all(page.map(
          current => this._patch(current[this.id], data, params))
        ).then(function (resp) {
          return resp;
        });
      });
    }
    return this._patch(id, data, params);
  }

  update (id, data, params) {
    return this._get(id).then(getData => {
      data[this.id] = id;
      return this.Model.get(getData[this.id])
        .replace(data, {
          returnChanges: true
        }).run().then(result =>
          (result.changes && result.changes.length) ? result.changes[0].new_val : data
        );
    }).then(select(params, this.id));
  }

  _remove (id, params) {
    let result = {};
    return this._get(id, params).then(found => {
      result = found;
      return found.delete().then(() => {
        return result;
      });
    });
  }

  remove (id, params) {
    if (!id) {
      return this._find(params).then(({data}) => {
        return Promise.all(data.map(
            current => this._remove(current[this.id], params)
          )).then(function (resp) {
            return resp;
          });
      }
      );
    }

    return this._remove(id, params);
  }

  setup () {
    if (this.watch) {
      this._cursor = this.Model.changes().execute().then(cursor => {
        cursor.each((error, data) => {
          if (error || typeof this.emit !== 'function') {
            return;
          }
          let ov = data.getOldValue();

          if (!data.isSaved()) {
            this.emit('removed', data);
          } else if (!ov) {
            this.emit('created', data);
          } else {
            this.emit('updated', data);
            this.emit('patched', data);
          }
        });
        return cursor;
      });
    }
  }
}

export default function init (options) {
  return new Service(options);
}

init.Service = Service;
