/*jslint node: true */
'use strict';

var express = require('express');
var paginate = require('express-paginate');
var Route = require('route-parser');
var define = require('define-js');
var unless = require('express-unless');
var businessController = require('./controller.js').businessController;
var BusinessBehaviourType = require('./business/BusinessBehaviour.js').BusinessBehaviourType;
var BusinessBehaviour = require('./business/BusinessBehaviour.js').BusinessBehaviour;
var getInputObjects = require('./utils.js').getInputObjects;
var setResponse = require('./utils.js').setResponse;

var backend = module.exports;
var join = backend.join = function() {

    var utility = require('url');
    return function(s1, s2) {

        return utility.resolve(s1.substr(0, s1.endsWith('/') ? s1.length - 1 : s1.length) + '/', s2.substr(s2.startsWith('/') ? 1 : 0));
    };
}();

var routers = {};
var behaviours = {

    behaviours: {

        method: 'GET',
        path: '/behaviours'
    }
};
var types = {

    'database': BusinessBehaviourType.OFFLINESYNC,
    'integration': BusinessBehaviourType.ONLINESYNC,
    'database_with_action': BusinessBehaviourType.OFFLINEACTION,
    'integration_with_action': BusinessBehaviourType.ONLINEACTION
};
var defaultPrefix = null;
var app = backend.app = express();

backend.behaviour = function(path) {

    return function(options, getConstructor) {

        if (typeof options !== 'object') {

            throw new Error('Invalid definition object');
        }
        if (typeof options.type !== 'string' || !types[options.type]) {

            options.type = 'database';
        }
        if (typeof options.version !== 'string' || options.version.length === 0) {

            throw new Error('Invalid behaviour version');
        }
        if (typeof options.inherits === 'function' && !(options.inherits.prototype instanceof BusinessBehaviour)) {

            throw new Error('Super behaviour constructor does not inherit from BusinessBehaviour');
        }
        if (typeof getConstructor !== 'function') {

            throw new Error('Invalid constructor');
        }
        var BehaviourConstructor = typeof options.inherits === 'function' ? define(getConstructor)
            .extend(options.inherits).parameters({

                type: types[options.type],
                inputObjects: options.defaults
            }) : define(getConstructor).extend(BusinessBehaviour)
            .parameters({

                type: types[options.type]
            });
        if (typeof options.name === 'string' || options.name.length > 0) {

            if (!defaultPrefix && typeof path === 'string' && path.length > 0) defaultPrefix = path;
            var prefix = path || defaultPrefix;
            if (options.name === 'behaviours') {

                throw new Error('behaviours is a reserved name');
            }
            var req_handler = function(req, res, next) {

                var inputObjects = getInputObjects(options.parameters, req);
                if (options.paginate) {

                    inputObjects.paginate = true;
                    inputObjects.page = req.query.page;
                    inputObjects.limit = req.query.limit;
                }
                var behaviour = new BehaviourConstructor({

                    type: types[options.type],
                    priority: options.priority || 0,
                    inputObjects: inputObjects
                });
                var cancel = businessController(typeof options.queue == 'function' ? options.queue() : options.queue)
                    .runBehaviour(behaviour, options.paginate ? function(property, superProperty) {

                        var page = {

                            modelObjects: 'modelObjects',
                            pageCount: 'pageCount'
                        };
                        return typeof options.map === 'function' ? options.map(property, superProperty) || page[property] : page[property];
                    } : options.map, function(behaviourResponse, error) {

                        if (typeof error === 'object' || typeof behaviourResponse !== 'object') {

                            if (error) error.name = options.name;
                            if (error) error.version = options.version;
                            next(error || new Error('Error while executing ' + options.name + ' behaviour, version ' + options.version + '!'));
                        } else {

                            var response = {

                                behaviour: options.name,
                                version: options.version,
                                response: options.paginate ? behaviourResponse.modelObjects || behaviourResponse : behaviourResponse
                            };
                            if (options.paginate) response.has_more = paginate.hasNextPages(req)(typeof behaviourResponse.pageCount === 'number' ?
                                behaviourResponse.pageCount : 1);
                            if (!setResponse(options.returns, req, res, response)) next();
                        }
                    });
                req.on('close', function() {

                    if (typeof cancel === 'function') cancel();
                });
            };
            if (Array.isArray(options.unless)) {

                req_handler.unless = unless;
                req_handler = req_handler.unless({

                    custom: function(request) {

                        return options.unless.map(function(name) {

                            return (behaviours[name] && behaviours[name].path) || name;
                        }).filter(function(suffix) {

                            var route = typeof prefix === 'string' && typeof suffix === 'string' ?
                                backend.join(prefix, suffix) : suffix || prefix;
                            if (route) route = new Route(route);
                            return route && route.match(request.path);
                        }).length > 0;
                    }
                });
            }
            if (typeof options.path == 'string' && options.path.length > 0 && typeof options.method === 'string' &&
                typeof app[options.method.toLowerCase()] == 'function') {

                var router = null;
                if (typeof prefix === 'string' && prefix.length > 0) {

                    router = routers[prefix];
                    if (!router) {

                        if (typeof app !== 'function' || typeof app.use !== 'function') {

                            throw new Error('Invalid express app');
                        }
                        router = express.Router({

                            caseSensitive: true,
                            mergeParams: true,
                            strict: true
                        });
                        router.use(paginate.middleware(10, 50));
                        app.use(prefix, router);
                        routers[prefix] = router;
                    }
                } else router = app;
                router[options.method.toLowerCase()](options.path, req_handler);
                behaviours[options.name] = {

                    version: options.version,
                    method: options.method,
                    path: options.path,
                    parameters: options.parameters,
                    returns: options.returns
                };
            } else if (typeof options.path == 'string' && options.path.length > 0)
                app.use(typeof prefix == 'string' && prefix.length > 0 ? join(prefix, options.path) : options.path, req_handler);
            else app.use(req_handler);
        }
        return BehaviourConstructor;
    };
};

backend.behaviours = function(path) {

    if (!defaultPrefix && typeof path === 'string' && path.length > 0) defaultPrefix = path;
    var prefix = path || defaultPrefix;
    app.get(typeof prefix === 'string' ? join(prefix + '/', '/behaviours') : '/behaviours', function(req, res) {

        res.json(behaviours);
    });
    return behaviours;
};

backend.meta = behaviours;

//var CacheController = require('./cache/CacheController.js').CacheController;
//var cacheController = new CacheController();
//var LogController = require('./logs/LogController.js').LogController;
//var logController = new LogController();
/*window.onerror = function(errorMsg, url, lineNumber) {

 try {

 throw new Error(errorMsg + '   ' + url + '   ' + lineNumber);
 } catch (e) {

 logController.log(e, JSON.parse(window.localStorage.getItem('currentUser')));
 }
 };*/
