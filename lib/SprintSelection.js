import _ from 'lodash';
import * as d3 from 'd3';
import {OrderedSet} from 'immutable';
import {vsprintf} from 'sprintf-js';
import {addDrag, updateOrderTags} from './tabs';
import {getUrl, setToggle} from './url';

export default class SprintSelection {
    constructor(state, localization, locales) {
        this.state = state;
        this.localization = localization;
        this.locales = locales;
    }

    hasFuture() {
        return this.state.formatter.current !== null &&
            this.state.sprints.future > 0 &&
            this.state.formatter.current.requestConfig().future &&
            !this.state.features.selected
                .intersect(this.state.features.future).isEmpty();
    }

    makeSprintTicks(x, num_sprints, future_sprints) {
        var ticks = x.ticks(Math.min(num_sprints + future_sprints, 10));
        const tick_distance = Math.ceil(Math.log10(num_sprints));
        const future_distance = Math.ceil(Math.log10(Math.abs(future_sprints)));
        if (ticks[0] < 0 && ticks[0] + future_sprints <= future_distance) {
            ticks[0] = -future_sprints;
        }
        else {
            ticks.unshift(-future_sprints);
        }
        if (num_sprints - ticks[ticks.length - 1] <= tick_distance) {
            ticks[ticks.length - 1] = num_sprints;
        }
        else {
            ticks.push(num_sprints);
        }
        return ticks;
    }

    makeSprintBrush() {
        const max = (name, default_value) => {
            const meta = _.maxBy(_.filter(this.state.projects.meta,
                p => this.state.projects.selected.includes(p.name)
            ), p => p[name]);
            if (!meta) {
                return default_value;
            }
            return meta[name];
        };
        const num_sprints = max('num_sprints', this.state.sprints.limit);
        const future_sprints = this.hasFuture() ? max('future_sprints', 0) : 0;

        const current = Math.max(0,
            Math.min(this.state.sprints.current, num_sprints)
        );
        const first = Math.max(-future_sprints,
            Math.min(this.state.sprints.first, current)
        );

        var tooltip;
        if (first < 0) {
            tooltip = 'sprints-count-tooltip-future';
        }
        else {
            tooltip = `sprints-count-tooltip${first === 0 ? "-recent" : ""}`;
        }

        const count = d3.select('#sprints-count')
            .attr("data-tooltip", this.locales.message(tooltip, [
                current - first, current, -first
            ]))
            .select('svg');
        const width = count.attr("width") - 32;
        const height = count.attr("height") - 16;

        const x = d3.scaleLinear()
            .domain([-future_sprints, num_sprints])
            .rangeRound([0, width]);

        const axis = d3.axisBottom(x)
            .tickValues(this.makeSprintTicks(x, num_sprints, future_sprints))
            .tickFormat(d3.format("d"));

        const svg = count.select('g')
            .attr('transform', 'translate(16, 0)');
        svg.select('g.axis')
            .attr("transform", `translate(0, ${height})`)
            .call(axis);

        const brush = d3.brushX()
            .extent([[0, 0], [width, height + 16]])
            .on("end", () => {
                if (!d3.event.sourceEvent || !d3.event.selection) {
                    return;
                }
                const pos = d3.event.selection.map(x.invert).map(Math.round);
                // Disallow selecting subset of future sprints that does not
                // start at the current time
                pos[1] = Math.max(0, pos[1]);
                window.location = getUrl(this.state, {
                    count: pos
                });
            });

        svg.select('g.brush')
            .call(brush)
            .call(brush.move, [x(first), x(current)]);
        svg.select('rect.future')
            .attr('width', x(0));
    }

    makeSprintFilter() {
        const onlyClosed = this.state.sprints.closed ? true : null;
        const closed = d3.select('#sprints-closed')
            .attr('disabled', onlyClosed)
            .select('input')
            .attr('disabled', onlyClosed)
            .attr('checked',
                onlyClosed || this.state.sprints.closedOnly ? true : null
            )
            .on('change.close', () => {
                window.location = getUrl(this.state, {
                    closed: [closed.property('checked') ? '1' : '0']
                });
            });
    }

    makeSprintMeta() {
        const meta = d3.select('#sprints-meta ul').selectAll('li')
            .data(this.state.sprint_meta.known);
        const newMeta = meta.enter().append('li');
        const label = newMeta.append('a')
            .classed('tooltip is-tooltip-multiline is-tooltip-center', true);
        label.append('span')
            .classed('meta', true)
            .text(d => this.locales.attribute("sprint_meta", d));
        label.append('span').classed('tag', true);
        addDrag(this.state, label, {
            name: "meta",
            items: this.state.sprint_meta,
            key: d => d
        });

        const updateMeta = newMeta.merge(meta)
            .classed('is-active', d => this.state.sprint_meta.selected.has(d));
        updateMeta.selectAll('a')
            .attr("data-tooltip", d => this.locales.message(`sprint-meta-${this.state.sprint_meta.selected.has(d) ? "deselect" : "select"}`,
                [this.locales.attribute("sprint-meta-tooltip", d)]
            ))
            .attr('href', d => getUrl(this.state, {
                meta: setToggle(this.state.sprint_meta.selected, d)
            }));
        updateMeta.selectAll('input')
            .property('checked', d => this.state.sprint_meta.selected.has(d));

        updateOrderTags(updateMeta, this.state.sprint_meta, d => d);
    }
}
