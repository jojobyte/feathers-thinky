'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

exports.default = init;

var _uberproto = require('uberproto');

var _uberproto2 = _interopRequireDefault(_uberproto);

var _feathersQueryFilters = require('feathers-query-filters');

var _feathersQueryFilters2 = _interopRequireDefault(_feathersQueryFilters);

var _feathersErrors = require('feathers-errors');

var _feathersErrors2 = _interopRequireDefault(_feathersErrors);

var _feathersCommons = require('feathers-commons');

var _parse = require('./parse');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var BASE_EVENTS = ['created', 'updated', 'patched', 'removed'];

// Create the service.

var Service = function () {
  function Service(options) {
    _classCallCheck(this, Service);

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

  _createClass(Service, [{
    key: 'extend',
    value: function extend(obj) {
      return _uberproto2.default.extend(obj, this);
    }
  }, {
    key: 'init',
    value: function init() {
      var _this = this;

      var r = this.Model._thinky.r;
      return r.dbList().contains(r._poolMaster._options.db).then(function () {
        return r.db(r._poolMaster._options.db).tableList().contains(_this.Model.getTableName());
      });
    }
  }, {
    key: 'createFilter',
    value: function createFilter(query) {
      return (0, _parse.createFilter)(query, this.Model._thinky.r);
    }
  }, {
    key: 'createQuery',
    value: function createQuery(originalQuery) {
      var _this2 = this;

      var _filter = (0, _feathersQueryFilters2.default)(originalQuery || {}),
          filters = _filter.filters,
          query = _filter.query;

      var rq = this.Model.filter(this.createFilter(query));

      // Handle $select
      if (filters.$select) {
        rq = rq.pluck(filters.$select);
      }

      // Handle $sort
      if (filters.$sort) {
        _feathersCommons._.each(filters.$sort, function (order, fieldName) {
          if (parseInt(order) === 1) {
            rq = rq.orderBy(fieldName);
          } else {
            var r = _this2.Model._thinky.r;
            rq = rq.orderBy(r.desc(fieldName));
          }
        });
      }

      return rq;
    }
  }, {
    key: '_find',
    value: function _find() {
      var params = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

      var paginate = typeof params.paginate !== 'undefined' ? params.paginate : this.paginate;
      // Prepare the special query params.

      var _filter2 = (0, _feathersQueryFilters2.default)(params.query || {}, paginate),
          filters = _filter2.filters;

      var q = params.rethinkdb || this.createQuery(params.query);
      var countQuery = void 0;

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
      return Promise.all([q, countQuery]).then(function (_ref) {
        var _ref2 = _slicedToArray(_ref, 2),
            data = _ref2[0],
            total = _ref2[1];

        if (paginate.default) {
          return {
            total: total,
            data: data,
            limit: filters.$limit,
            skip: filters.$skip || 0
          };
        }

        return data;
      });
    }
  }, {
    key: 'find',
    value: function find() {
      return this._find.apply(this, arguments);
    }
  }, {
    key: '_get',
    value: function _get(id) {
      var params = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      var query = void 0;
      // If an id was passed, just get the record.
      if (id !== null && id !== undefined) {
        query = this.Model.get(id);
      } else {
        query = this.Model.filter(params.query).limit(1);
      }

      if (params.query && params.query.$select) {
        query = query.pluck(params.query.$select.concat(this.id));
      }

      return query.run().then(function (data) {
        if (Array.isArray(data)) {
          data = data[0];
        }
        return data;
      }).catch(function () {
        throw new _feathersErrors2.default.NotFound('No record found for id \'' + id + '\'');
      });
    }
  }, {
    key: 'get',
    value: function get() {
      return this._get.apply(this, arguments);
    }
  }, {
    key: 'create',
    value: function create(data, params) {
      var idField = this.id;
      return this.Model.save(data).then(function (res) {
        if (data[idField]) {
          if (res.errors) {
            return Promise.reject(new _feathersErrors2.default.Conflict('Duplicate primary key', res.errors));
          }
          return data;
        } else {
          // add generated id
          var addId = function addId(current, index) {
            if (res.generated_keys && res.generated_keys[index]) {
              return Object.assign({}, current, _defineProperty({}, idField, res.generated_keys[index]));
            }

            return current;
          };

          if (Array.isArray(data)) {
            return data.map(addId);
          }

          return addId(data, 0);
        }
      }).then((0, _feathersCommons.select)(params, this.id));
    }
  }, {
    key: '_patch',
    value: function _patch(id, data, params) {
      return this._get(id, params).then(function (found) {
        return found.merge(data).save().then(function (response) {
          return response;
        });
      });
    }
  }, {
    key: 'patch',
    value: function patch(id, data, params) {
      var _this3 = this;

      if (id === null) {
        return this._find(params).then(function (page) {
          return Promise.all(page.map(function (current) {
            return _this3._patch(current[_this3.id], data, params);
          })).then(function (resp) {
            return resp;
          });
        });
      }
      return this._patch(id, data, params);
    }
  }, {
    key: 'update',
    value: function update(id, data, params) {
      var _this4 = this;

      return this._get(id).then(function (getData) {
        data[_this4.id] = id;
        return _this4.Model.get(getData[_this4.id]).replace(data, {
          returnChanges: true
        }).run().then(function (result) {
          return result.changes && result.changes.length ? result.changes[0].new_val : data;
        });
      }).then((0, _feathersCommons.select)(params, this.id));
    }
  }, {
    key: '_remove',
    value: function _remove(id, params) {
      var result = {};
      return this._get(id, params).then(function (found) {
        result = found;
        return found.delete().then(function () {
          return result;
        });
      });
    }
  }, {
    key: 'remove',
    value: function remove(id, params) {
      var _this5 = this;

      if (!id) {
        return this._find(params).then(function (_ref3) {
          var data = _ref3.data;

          return Promise.all(data.map(function (current) {
            return _this5._remove(current[_this5.id], params);
          })).then(function (resp) {
            return resp;
          });
        });
      }

      return this._remove(id, params);
    }
  }, {
    key: 'setup',
    value: function setup() {
      var _this6 = this;

      if (this.watch) {
        this._cursor = this.Model.changes().execute().then(function (cursor) {
          cursor.each(function (error, data) {
            if (error || typeof _this6.emit !== 'function') {
              return;
            }
            var ov = data.getOldValue();

            if (!data.isSaved()) {
              _this6.emit('removed', data);
            } else if (!ov) {
              _this6.emit('created', data);
            } else {
              _this6.emit('updated', data);
              _this6.emit('patched', data);
            }
          });
          return cursor;
        });
      }
    }
  }]);

  return Service;
}();

function init(options) {
  return new Service(options);
}

init.Service = Service;
module.exports = exports['default'];