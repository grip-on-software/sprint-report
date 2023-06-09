/**
 * Drag and drop of selected items in a menu to swap ordering.
 *
 * Copyright 2017-2020 ICTU
 * Copyright 2017-2022 Leiden University
 * Copyright 2017-2023 Leon Helwerda
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import _ from 'lodash';
import * as d3 from 'd3';
import {OrderedSet} from 'immutable';
import getUrl from './url';

/* Locate a valid drop target for the tab that is currently being dragged. */
const findTabs = (container) => {
    const view = d3.mouse(document.body);
    const viewX = view[0] - (document.documentElement.scrollLeft || document.body.scrollLeft);
    const viewY = view[1] - (document.documentElement.scrollTop || document.body.scrollTop);
    if (typeof document.elementsFromPoint === "function") {
        return d3.selectAll(document.elementsFromPoint(viewX, viewY))
            .filter('a:not(.dragging), label:not(.dragging)');
    }
    return d3.select(container).selectAll('a:not(.dragging), label:not(.dragging)').filter(function() {
        const rect = this.getBoundingClientRect();
        return rect.left <= viewX && viewY <= rect.left + rect.width &&
            rect.top <= viewY && viewY <= rect.top + rect.height;
    });
};

/* Add drag-and-drop behavior to a group of elements. */
const addDrag = (state, element, config) => {
    config = _.assign({}, {
        name: "project",
        items: {selected: OrderedSet()},
        key: d => d,
        relative: false
    }, config);
    if (element.empty()) {
        return;
    }
    element.call(d3.drag()
        // Consider a slight movement to still be a (de)selection
        .clickDistance(0.2 * _.mean(_.map(element.nodes(),
            node => node.getBoundingClientRect().width
        )))
        .filter(d => config.items.selected.has(config.key(d)))
        .subject(() => {return {x: d3.event.x, y: d3.event.y};})
        .on("start", (d, i, nodes) => {
            d3.select(nodes[i]).classed("drag", true);
            const initial = d3.mouse(config.relative ? config.relative :
                nodes[i]
            );
            d3.event.on("drag", (d, i, nodes) => {
                d3.select(nodes[i])
                    .classed("dragging", true)
                    .style("left", `${d3.event.x - initial[0]}px`)
                    .style("top", `${d3.event.y - initial[1]}px`);
            })
            .on("end", (d, i, nodes) => {
                const dropTab = d3.select(findTabs(nodes[i].parentNode.parentNode).node());
                const dragged = d3.select(nodes[i]);
                dragged.transition()
                    .duration(200)
                    .ease(d3.easeLinear)
                    .style("left", "0px")
                    .style("top", "0px")
                    .on("end", () => {
                        dragged.classed("drag dragging", false);
                    });
                if (dropTab.empty()) {
                    return;
                }
                const drag = config.key(d);
                const drop = config.key(dropTab.datum());
                if (!config.items.selected.has(drag) ||
                    !config.items.selected.has(drop)
                ) {
                    return;
                }
                const swap = _.fromPairs([[drag, drop], [drop, drag]]);
                document.location = getUrl(state, _.fromPairs([[config.name,
                    _.map(Array.from(config.items.selected),
                        name => swap[name] || name
                    )
                ]]));
            });
        })
    );
};

/* Update elements to indicate the order that they are selected in. */
const updateOrderTags = (element, items, key) => {
    const order = _.zipObject(Array.from(items.selected),
        _.range(1, items.selected.size + 1)
    );
    element.selectAll('span.tag')
        .classed('is-hidden', d => !order[key(d)])
        .text(d => order[key(d)] || null);
};

export {addDrag, updateOrderTags};
