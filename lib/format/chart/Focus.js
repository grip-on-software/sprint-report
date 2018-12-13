import _ from 'lodash';
import * as d3 from 'd3';

const offset = {
    height: 16,
    icon: 20,
    option: 8
};

const padding = {top: 5, left: 15, right: 15, bottom: 10};

const checkClickRect = (target, rect) => {
    return target[0] >= rect.left &&
        target[0] <= rect.right &&
        target[1] >= rect.top &&
        target[1] <= rect.bottom;
};

export default class Focus {
    constructor(chart, data, state, sprints, y, callbacks) {
        this.chart = chart;
        this.data = data;
        this.state = state;
        this.sprints = sprints;
        this.y = y;
        this.callbacks = callbacks;
        this.focusHolder = chart.select('.focus');

        const bbox = callbacks.bbox();
        this.width = bbox.width;
        this.height = bbox.height;
    }

    show() {
        this.focusHolder.style("visibility", null);
    }

    hide() {
        if (!_.isEqual(this.focusHolder.datum(), [0])) {
            this.focusHolder.style("visibility", "hidden");
        }
        this.focusHolder.datum([]);
    }

    selectFeature(eventTarget) {
        const target = d3.mouse(eventTarget);
        const j = this.y.invert(target[1]);
        var x1 = this.callbacks.range();
        var i = this.callbacks.mouseIndex(x1.invert(target[0]));
        var index = i;
        var scale = this.y;
        var feature = this.callbacks.select(i, j, target);
        if (_.isObject(feature)) {
            ({ feature, i, index, scale } = feature);
        }
        const pos = typeof feature === "undefined" ? 0 : scale(feature);
        return {target, i, j, feature, pos, index};
    }

    showTooltip(index, i, feature, pos) {
        this.callbacks.focus(this.focusHolder, i, pos);

        const tooltip = this.focusHolder.selectAll('.details');
        const missing = typeof this.sprints[index] === "undefined";
        tooltip.style("visibility", missing ? "hidden" : null);
        if (missing) {
            return null;
        }

        tooltip.selectAll("path.icon").remove();
        const metadata = _.toPairs(_.pick(this.sprints[index],
            this.callbacks.filter(_.concat(
                Array.from(this.state.sprint_meta.selected),
                Array.from(this.state.features.selected)
            ))
        ));
        this.updateTooltipMetadata(tooltip, metadata, index, feature);
        this.updateTooltipOptions(tooltip, index);

        const bbox = tooltip.select("text").node().getBBox();
        tooltip.select("rect")
            .attr("width", bbox.width + padding.left + padding.right)
            .attr("height", bbox.height + padding.top + padding.bottom);
        return bbox;
    }

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
            .classed("has-source",
                (d, i, nodes) => this.callbacks.has_source(d, i) &&
                    this.callbacks.link(d, index, d3.select(nodes[i]), -1)
            )
            .classed("highlight",
                d => this.callbacks.highlight(d, index, feature)
            )
            .each((d, j, nodes) => {
                this.updateMetadata(tooltip, d, index, j, d3.select(nodes[j]));
            });
    }

    updateMetadata(tooltip, d, index, j, node) {
        const source = this.callbacks.link(d, index, node, -1).type;
        const sourceIcon = this.callbacks.source_icon(source);

        node.text('');
        const adjust = {
            class: d[0],
            scale: 0.025,
            top: padding.top + offset.height * j + 4,
            left: padding.left + 4 + (sourceIcon ? offset.icon : 0)
        };
        const text = this.callbacks.format(d[0], d[1], node, index, adjust);
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

    updateTooltipOptions(tooltip, index) {
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
                this.updateOption(tooltip, text, d, i, nodes);
            });
    }

    updateOption(tooltip, text, d, i, nodes) {
        const width = d.icon ? offset.icon : offset.option;
        const optionPadding = d.text ? offset.option : 0;
        const optionText = text.append("tspan")
            .classed("option", true)
            .classed("has-source", !!d.click)
            .classed("has-icon", !!d.icon)
            .datum(d.id)
            .attr("id", `option-${d.id}`)
            .attr('x', i === 0 ? padding.left + width : null)
            .attr('dx', i === 0 ? null : `${optionPadding * -3 + 24}px`)
            .attr('dy', i === 0 ? '1.6em' : null)
            .attr('style', 'font-size: 1.2em')
            .text(`\u00A0${d.text || ""}`);
        const node = optionText.node();
        var size;
        try {
            const bbox = node.getBBox();
            const textWidth = node.getComputedTextLength();
            size = {
                left: bbox.x + _.sumBy(nodes, node => {
                    const rect = d3.select(node).select("rect");
                    if (rect.empty()) {
                        return 0;
                    }
                    return Number(rect.attr("width"));
                }),
                top: bbox.y + metadata.length * offset.height,
                width: textWidth + width,
                height: 27
            };
        }
        catch (ex) {
            const nbox = node.getBoundingClientRect();
            const cbox = tooltip.node().getBoundingClientRect();
            size = {
                left: nbox.left - width - cbox.x,
                top: nbox.top - cbox.y,
                width: nbox.width + width + optionPadding,
                height: nbox.height
            };
        }

        const option = d3.select(nodes[i]);
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

    pinTooltip(eventTarget) {
        var { target, i, feature, pos, index } = this.selectFeature(eventTarget);
        const tooltip = this.focusHolder.selectAll(".details");
        const rect = tooltip.select("rect");
        if (!tooltip.datum()) {
            return true;
        }
        const { pos: position, index: current } = tooltip.datum();
        if (this.callbacks.click(target)) {
            this.focusHolder.datum(null);
            return true;
        }

        const datum = this.focusHolder.datum();
        if (_.isEqual(datum, [])) {
            return false;
        }
        const fixed = _.isEqual(datum, [0]);
        if (fixed && checkClickRect(target, {
            left: position[0],
            right: position[0] + Number(rect.attr("width")),
            top: position[1],
            bottom: position[1] + Number(rect.attr("height"))
        })) {
            return this.clickTooltip(tooltip, target, position, current);
        }
        const newIndex = typeof current === "undefined" ? index : current;
        this.updateFocusPosition(target, newIndex, fixed ? [i, feature] : [0],
            this.showTooltip(newIndex, i, feature, pos)
        );
        return false;
    }

    clickTooltip(tooltip, target, position, current) {
        const meta = tooltip.selectAll("tspan.meta").size();
        const rects = tooltip.selectAll("g.option rect").nodes();
        const item = tooltip.selectAll("tspan.meta, tspan.option")
            .filter((d, j, nodes) => {
                return this.findClickedTooltip(target, position, meta, rects,
                    d, j, nodes
                );
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
                        this.showTooltip(index, i, feature, this.y(feature))
                    );
                    return true;
                }
            }
        }
        else if (item.classed("meta")) {
            const link = this.callbacks.link(item.datum(), current, item,
                target[0] - position[0] - padding.left
            );
            if (link) {
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

    findClickedTooltip(target, position, meta, rects, d, j, nodes) {
        const item = d3.select(nodes[j]);
        if (!item.classed("has-source") &&
            item.select("tspan.has-source").empty()
        ) {
            return false;
        }
        var rect;
        try {
            const bbox = nodes[j].getBBox();
            const left = j < meta ? padding.left :
                bbox.x + _.sumBy(_.takeWhile(rects,
                    (n, i) => i < j - meta
                ), node => {
                    const rect = d3.select(node);
                    return Number(rect.attr("width"));
                });
            const itemTop = padding.top + Math.min(j, meta) * offset.height;
            rect = {
                left: position[0] + left,
                right: position[0] + left +
                    nodes[j].getComputedTextLength() +
                    (item.classed("has-icon") ? offset.icon : 0),
                top: position[1] + itemTop,
                bottom: position[1] + itemTop + (j < meta ? offset.height : 27)
            };
        }
        catch (ex) {
            const nbox = nodes[j].getBoundingClientRect();
            const cbox = this.chart.selectAll(".overlay")
                .node().getBoundingClientRect();
            rect = {
                left: nbox.left - cbox.x -
                    (item.classed("has-icon") ? offset.icon : 0),
                right: nbox.right - cbox.x,
                top: nbox.top - cbox.y,
                bottom: nbox.bottom - cbox.y
            };
        }
        return checkClickRect(target, rect);
    }
}