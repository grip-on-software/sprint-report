/**
 * Focus element to indicate nearby sprints/features when hovering in a chart.
 *
 * Copyright 2017-2020 ICTU
 * Copyright 2017-2022 Leiden University
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

const offset = {
    height: 16,
    icon: 20,
    option: 8
};

const padding = {top: 5, left: 15, right: 15, bottom: 10};

const SOURCE_CLASS = "has-source";

/* Determine whether a click event target if within a rectangle bounding box. */
const checkClickRect = (target, rect) => {
    return target[0] >= rect.left &&
        target[0] <= rect.right &&
        target[1] >= rect.top &&
        target[1] <= rect.bottom;
};

/**
 * Focus element within a chart format.
 */
export default class Focus {
    constructor(chart, data, state, sprints, callbacks) {
        this.chart = chart;
        this.data = data;
        this.state = state;
        this.sprints = sprints;
        this.callbacks = callbacks;
        this.focusHolder = chart.select('.focus');

        const bbox = callbacks.bbox();
        this.width = bbox.width;
        this.height = bbox.height;
    }

    /**
     * Display the focus element items.
     */
    show() {
        this.focusHolder.style("visibility", null);
    }

    /**
     * Hide the focus element items.
     */
    hide() {
        if (!_.isEqual(this.focusHolder.datum(), [0])) {
            this.focusHolder.style("visibility", "hidden");
        }
        this.focusHolder.datum([]);
    }

    /**
     * Determine the closest relevant point within the chart to the current
     * event target.
     */
    selectFeature(eventTarget) {
        const target = d3.mouse(eventTarget);
        const j = this.callbacks.y.invert(target[1]);
        const x1 = this.callbacks.range();
        let i = this.callbacks.mouseIndex(x1.invert(target[0]));
        let index = i;
        let scale = this.callbacks.y;
        let feature = this.callbacks.select(i, j, target);
        if (_.isObject(feature)) {
            ({ feature, i, index, scale } = feature);
        }
        const pos = typeof feature === "undefined" ? 0 : scale(feature);
        return {target, i, j, feature, pos, index};
    }

    /**
     * Display the focus tooltip.
     */
    showTooltip(index, i, feature, pos) {
        this.callbacks.focus(this.focusHolder, i, pos, feature);

        const tooltip = this.focusHolder.selectAll('.details');
        const missing = _.isEmpty(this.sprints[index]);
        tooltip.style("visibility", missing ? "hidden" : null);
        if (missing) {
            return null;
        }

        tooltip.selectAll("path").remove();
        const metadata = this.callbacks.augment(
            _.toPairs(_.pick(this.sprints[index],
                this.callbacks.filter(_.concat(
                    Array.from(this.state.sprint_meta.selected),
                    Array.from(this.state.features.selected)
                ))
            )), index
        );
        this.updateTooltipMetadata(tooltip, metadata, index, feature);
        this.updateTooltipOptions(tooltip, metadata, index);

        const bbox = tooltip.select("text").node().getBBox();
        tooltip.select("rect")
            .attr("width", bbox.width + padding.left + padding.right)
            .attr("height", bbox.height + padding.top + padding.bottom);
        return bbox;
    }

    /**
     * Update the metadata fields that describe the currently selected sprint
     * and its feature(s) in the focus tooltip.
     */
    updateTooltipMetadata(tooltip, metadata, index, feature) {
        const text = tooltip.select("text")
            .attr("x", padding.left)
            .attr("y", padding.top);
        const meta = text.selectAll("tspan.meta").data(metadata);
        meta.exit().remove();
        meta.enter().append("tspan")
            .classed("meta", true)
            .attr('dy', offset.height)
            .merge(meta).order()
            .attr('x', padding.left)
            .classed("has-icon", false)
            .classed(SOURCE_CLASS, (d, i, nodes) => {
                if (!this.callbacks.has_source(d, i)) {
                    return false;
                }
                const link = this.callbacks.link(d, index, d3.select(nodes[i]),
                    -1
                );
                return link && link.source !== null;
            })
            .classed("highlight",
                d => this.callbacks.highlight(d, index, feature)
            )
            .each((d, j, nodes) => {
                this.updateMetadata(tooltip, d, index, j, d3.select(nodes[j]));
            });
    }

    /**
     * Update a metadata field in the focus tooltip.
     */
    updateMetadata(tooltip, d, index, j, node) {
        const source = this.callbacks.link(d, index, node, -1).type;
        const sourceIcon = this.callbacks.source_icon(source);
        const classes = [d[0]];
        if (node.classed(SOURCE_CLASS)) {
            classes.push(SOURCE_CLASS);
        }

        // Remove any previous text so the formatter properly replaces it
        node.text('');
        const adjust = {
            class: _.join(classes, ' '),
            scale: 0.025,
            top: padding.top + offset.height * j + 4,
            left: padding.left + 4 + (sourceIcon ? offset.icon : 0)
        };
        const text = this.callbacks.format(d, node, index, adjust, tooltip);
        if (text !== null) {
            node.text(text);
        }

        if (sourceIcon) {
            this.callbacks.add_icon(tooltip, sourceIcon, {
                scale: 0.025,
                top: padding.top + offset.height * j + 4,
                left: padding.left
            });
            node.classed("has-icon", true)
                .attr("x", padding.left + offset.icon);
        }
    }

    /**
     * Update clickable options (if any) below the metadata fields within the
     * focus tooltip.
     */
    updateTooltipOptions(tooltip, metadata, index) {
        const text = tooltip.select("text");
        const options = tooltip.select("g.options")
            .selectAll("g.option")
            .data(this.callbacks.options(tooltip, index));
        options.exit().merge(options)
            .each((d, i, nodes) => {
                text.select(`#option-${d.id}`).remove();
                d3.select(nodes[i]).selectAll("*").remove();
            });
        options.exit().remove();
        options.enter().append("g")
            .classed("option", true)
            .merge(options).order()
            .each((d, i, nodes) => {
                const size = this.updateOption(metadata, text, d, i, nodes);
                this.updateOptionSize(d3.select(nodes[i]), d, size);
            });
    }

    /**
     * Update a clickable option below the metadata fields within the tooltip.
     */
    updateOption(metadata, text, d, i, nodes) {
        const width = d.icon ? offset.icon : offset.option;
        const optionPadding = d.text ? offset.option : 0;
        const optionText = text.append("tspan")
            .classed("option", true)
            .classed(SOURCE_CLASS, !!d.click)
            .classed("has-icon", !!d.icon)
            .datum(d.id)
            .attr("id", `option-${d.id}`)
            .attr('x', i === 0 ? padding.left + width : null)
            .attr('dx', i === 0 ? null : `${optionPadding * -3 + 24}px`)
            .attr('dy', i === 0 ? '1.6em' : null)
            .attr('style', 'font-size: 1.2em')
            .text(`\u00A0${d.text || ""}`);
        const node = optionText.node();
        const bbox = node.getBBox();
        const nbox = node.getBoundingClientRect();
        const cbox = text.node().getBoundingClientRect();
        const textWidth = node.getComputedTextLength();
        return {
            left: bbox.x - nbox.left + cbox.x + _.sumBy(nodes, node => {
                const rect = d3.select(node).select("rect");
                if (rect.empty()) {
                    return 0;
                }
                return Number(rect.attr("width"));
            }),
            top: bbox.y - nbox.top + cbox.y + metadata.length * offset.height + 4,
            width: textWidth + width,
            height: 27
        };
    }

    /**
     * Correct the position and size of a clickable option in the tooltip.
     */
    updateOptionSize(option, d, size) {
        option.attr("transform", `translate(${size.left}, ${size.top})`);
        option.append("rect")
            .attr("width", size.width)
            .attr("height", size.height)
            .attr("rx", 5)
            .attr("ry", 5);
        if (typeof d.icon !== "undefined") {
            this.callbacks.add_icon(option, d.icon, {
                scale: 0.025,
                width: 16,
                left: 8,
                top: (size.height - 12) / 2
            });
        }
    }

    /**
     * Adjust the position of the focus tooltip based on the event target.
     */
    updateFocusPosition(target, index, datum, bbox) {
        if (bbox === null) {
            this.focusHolder.classed("fixed", false).datum([]);
            return;
        }
        const width = bbox.width + padding.left + padding.right;
        const height = bbox.height + padding.top + padding.bottom;
        const x = target[0] + width > this.width ? target[0] - width :
            target[0];
        const y = target[1] + height > this.height ? target[1] - height :
            target[1];
        this.focusHolder.classed("fixed", _.isEqual(datum, [0]))
            .datum(datum)
            .selectAll(".details")
            .attr("transform", `translate(${x}, ${y})`)
            .datum({pos: [x, y], index: index});
    }

    /**
     * Handle a hover event that causes the tooltip to be placed at a new
     * position if it is to be visible.
     */
    moveTooltip(eventTarget) {
        const datum = this.focusHolder.datum();
        if (_.isEqual(datum, [0])) {
            return false;
        }
        const { target, i, feature, pos, index } = this.selectFeature(eventTarget);

        if (_.isEqual(datum, [i, feature])) {
            const bbox = this.focusHolder.selectAll(".details")
                .select("text").node().getBBox();
            this.updateFocusPosition(target, index, [i, feature], bbox);
            return false;
        }
        this.updateFocusPosition(target, index, [i, feature],
            this.showTooltip(index, i, feature, pos)
        );
        return true;
    }

    /**
     * Handle a click event that causes the tooltip to be fixed at a position,
     * or which handles a click in the tooltip if it was already pinned.
     */
    pinTooltip(eventTarget) {
        const { target, i, feature, pos, index } = this.selectFeature(eventTarget);
        const tooltip = this.focusHolder.selectAll(".details");
        const { pin, found, fixed } = this.findClickTooltip(tooltip, target);
        if (!found) {
            if (this.callbacks.click(target)) {
                this.focusHolder.datum(null);
                return true;
            }
        }
        if (pin) {
            return pin;
        }
        const { index: current } = tooltip.datum();
        const newIndex = typeof current === "undefined" ? index : current;
        this.updateFocusPosition(target, newIndex, fixed ? [i, feature] : [0],
            this.showTooltip(newIndex, i, feature, pos)
        );
        return false;
    }

    /**
     * Find a position within the tooltip that is being clicked if the tooltip
     * was already pinned, otherwise indicite the current tooltip state.
     */
    findClickTooltip(tooltip, target) {
        if (!tooltip.datum()) {
            return { pin: true, found: false, fixed: false };
        }
        const datum = this.focusHolder.datum();
        if (_.isEqual(datum, [])) {
            return { pin: false, found: false, fixed: false };
        }

        const fixed = _.isEqual(datum, [0]);
        const { pos: position, index: current } = tooltip.datum();
        const rect = tooltip.select("rect");
        if (fixed && checkClickRect(target, {
            left: position[0],
            right: position[0] + Number(rect.attr("width")),
            top: position[1],
            bottom: position[1] + Number(rect.attr("height"))
        })) {
            return {
                pin: this.clickTooltip(tooltip, target, position, current),
                found: true,
                fixed: fixed
            };
        }
        return { pin: false, found: false, fixed: fixed };
    }

    /**
     * Handle a click within the tooltip which may trigger
     */
    clickTooltip(tooltip, target, position, current) {
        const meta = tooltip.selectAll("tspan.meta").size();
        const rects = tooltip.selectAll("g.option rect").nodes();
        const item = tooltip.selectAll("tspan.meta, tspan.option")
            .filter((d, j, nodes) => {
                const rect = this.findClickedRect(position, meta, rects, j,
                    nodes
                );
                return !_.isEmpty(rect) && checkClickRect(target, rect);
            });
        if (item.empty()) {
            return false;
        }
        if (item.classed("option")) {
            const options = this.callbacks.options(tooltip, current);
            const option = _.find(options, d => d.id === item.datum());
            if (option && option.click) {
                const result = option.click();
                if (result === false) {
                    tooltip.style("visibility", "hidden");
                    this.focusHolder.datum(null);
                    return true;
                }
                else if (_.isObject(result)) {
                    const { index, i, feature } = result;
                    this.updateFocusPosition(position, index, [0],
                        this.showTooltip(index, i, feature,
                            this.callbacks.y(feature)
                        )
                    );
                    return true;
                }
            }
        }
        else if (item.classed("meta")) {
            const link = this.callbacks.link(item.datum(), current, item,
                target[0] - position[0] - padding.left
            );
            if (link && link.source !== null) {
                const source = d3.select(document.body)
                    .append('a')
                    .classed('is-hidden', true)
                    .attr('target', '_blank')
                    .attr('href',
                        this.callbacks.makeLink(link.source, current)
                    );
                source.node().click();
                source.remove();
                return true;
            }
        }
        return false;
    }

    /**
     * Retrieve the bounding box of a metadata field or option within the focus
     * tooltip which is relative to the position that the tooltip is fixed at.
     * The bounding box is the area that the field or option can be clicked on.
     * Poor man's SVG link element that works with tspan elements.
     */
    findClickedRect(position, meta, rects, j, nodes) {
        const item = d3.select(nodes[j]);
        if (!item.classed(SOURCE_CLASS) &&
            item.select(`tspan.${SOURCE_CLASS}`).empty()
        ) {
            return {};
        }
        const bbox = nodes[j].getBBox();
        const nbox = nodes[j].getBoundingClientRect();
        const cbox = nodes[j].parentNode.getBoundingClientRect();
        const left = j < meta ? padding.left :
            bbox.x - nbox.left + cbox.x + _.sumBy(_.takeWhile(rects,
                (n, i) => i < j - meta
            ), node => {
                const rect = d3.select(node);
                return Number(rect.attr("width"));
            });
        const itemTop = padding.top + Math.min(j, meta) * offset.height + 4;
        return {
            left: position[0] + left,
            right: position[0] + left +
                nodes[j].getComputedTextLength() +
                (item.classed("has-icon") ? offset.icon : 0),
            top: position[1] + itemTop,
            bottom: position[1] + itemTop + (j < meta ? offset.height : 27)
        };
    }
}
