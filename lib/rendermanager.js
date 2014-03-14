/*
 * Copyright (c) 2014 Adobe Systems Incorporated. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

(function () {
    "use strict";

    var os = require("os"),
        events = require("events"),
        util = require("util");

    var Q = require("q");

    var renderer = require("./renderer");

    var createSVGRenderer = renderer.createSVGRenderer,
        createPixmapRenderer = renderer.createPixmapRenderer;

    var CHANGE_DELAY = 1000,
        MAX_JOBS = os.cpus().length;

    function RenderManager(generator) {
        this._generator = generator;

        this._svgRenderers = {};
        this._pixmapRenderers = {};

        this._pending = {};
        this._working = {};
    }

    util.inherits(RenderManager, events.EventEmitter);

    RenderManager.prototype._generator = null;

    RenderManager.prototype._document = null;

    RenderManager.prototype._svgRenderer = null;

    RenderManager.prototype._pixmapRenderer = null;

    RenderManager.prototype._changeTimer = null;

    RenderManager.prototype._workSet = null;

    RenderManager.prototype._jobCounter = 0;

    RenderManager.prototype._getSVGRenderer = function (document) {
        if (!this._svgRenderers.hasOwnProperty(document.id)) {
            this._svgRenderers[document.id] = createSVGRenderer(this._generator, document);
        }

        return this._svgRenderers[document.id];
    };

    RenderManager.prototype._getPixmapRenderer = function (document) {
        if (!this._pixmapRenderers.hasOwnProperty(document.id)) {
            this._pixmapRenderers[document.id] = createPixmapRenderer(this._generator, document);
        }

        return this._pixmapRenderers[document.id];
    };

    /**
     * If the work set is non-empty, begin processing it by removing one layer
     * id, rendering its components, and then recursively processing the rest
     * of the work set.
     */
    RenderManager.prototype._processWorkSet = function () {
        var keys = Object.keys(this._pending);

        if (keys.length >= MAX_JOBS) {
            return;
        }

        if (keys.length > 0) {
            // Pick a component to process from the pending set
            var componentId = keys[0],
                job = this._pending[componentId];

            delete this._pending[componentId];
            this._working[componentId] = job;

            var document = job.document,
                layer = job.layer,
                component = job.component;

            this._renderComponent(document, layer, component)
                .fail(function (err) {
                    console.warn("Failed to render layer " + layer.id, err.stack);
                })
                .finally(function () {
                    delete this._working[componentId];
                    this._processWorkSet();
                }.bind(this));

            this._processWorkSet();
        } else {
            console.log("Rendering quiesced.");
            this._changeTimer = null;
        }
    };

    /**
     * Render all the components of a layer.
     */
    RenderManager.prototype._renderComponent = function (document, layer, component) {
        var boundsSettings = {
            boundsOnly: true
        };

        console.log("Rendering layer %d", layer.id);
        if (component.extension === "svg") {
            return this._getPixmapRenderer(document).render(layer, component);
        } else {
            return this._generator.getPixmap(document.id, layer.id, boundsSettings)
            .then(function (pixmapInfo) {
                var exactBounds = pixmapInfo.bounds;
                return this._getPixmapRenderer(document).render(layer, component, exactBounds);
            }.bind(this));
        }
    };

    RenderManager.prototype.render = function (document, layer, component, componentId) {
        if (this._workSet.hasOwnProperty(componentId)) {
            throw new Error("Render already pending for component: %d", componentId);
        }

        var deferred = Q.defer();

        this._workSet[componentId] = {
            deferred: deferred,
            document: document,
            layer: layer,
            component: component
        };

        if (!this._changeTimer) {
            this._changeTimer = setTimeout(function () {
                this._processWorkSet();
            }.bind(this), CHANGE_DELAY);
        }

        return deferred.promise;
    };

    RenderManager.prototype.cancel = function (componentId) {
        var job,
            set;

        if (this._pending.hasOwnProperty(componentId)) {
            set = this._pending;
        } else if (this._working.hasOwnProperty(componentId)) {
            set = this._working;
        }

        job = set[componentId];
        delete set[componentId];
        job.deferred.reject();
    };



    /**
     * Stop rendering this document's layer components. 
     */
    RenderManager.prototype.finish = function () {
        this._workSet = {};
        this._document.off("change");
    };

    module.exports = RenderManager;
}());