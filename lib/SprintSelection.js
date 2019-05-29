import _ from 'lodash';
import * as d3 from 'd3';
import {addDrag, updateOrderTags} from './tabs';
import {getUrl, setToggle} from './url';
import {TOOLTIP_ATTR, LABEL_ATTR} from './attrs';

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

    makeSprintTicks(x, num_sprints, future_sprints, transform) {
        var ticks = x.ticks(Math.min(num_sprints + future_sprints, 10));
        const tick_distance = Math.ceil(Math.log10(num_sprints));
        const future_distance = Math.ceil(Math.log10(future_sprints));
        const ends = transform([
            ticks => [0, 0],
            ticks => [ticks.length - 2, ticks.length - 1]
        ]);
        const [future, future_min] = ends[0](ticks);
        if (ticks[future_min] < 0 &&
            ticks[future_min] + future_sprints <= future_distance
        ) {
            ticks.splice(future, 2, -future_sprints);
        }
        else {
            ticks.splice(future_min, 1, -future_sprints);
        }

        const [past, past_min] = ends[1](ticks);
        if (num_sprints - ticks[past_min] <= tick_distance) {
            ticks.splice(past, 2, num_sprints);
        }
        else {
            ticks.splice(past_min, 1, num_sprints);
        }
        return ticks;
    }

    formatSprintTick(d, low, high) {
        if (d === 0) {
            return this.locales.message("sprints-select-current");
        }
        else if (d === low) {
            return this.locales.message("sprints-select-future", [Math.abs(d)]);
        }
        else if (d === high) {
            return this.locales.message("sprints-select-past", [d]);
        }
        return Math.abs(d);
    }

    max(name, default_value) {
        const meta = _.maxBy(_.filter(this.state.projects.meta,
            p => this.state.projects.selected.includes(p.name)
        ), p => p[name]);
        if (!meta) {
            return default_value;
        }
        return meta[name];
    }

    makeBrushTooltip(count, num) {
        var tooltip;
        const [first, current, last] = num;
        if (first < 0) {
            tooltip = `sprints-count-tooltip-future${current === first || current === 0 ? "-recent" : ""}`;
        }
        else {
            tooltip = `sprints-count-tooltip${first === 0 ? "-recent" : ""}`;
        }

        return count.attr(TOOLTIP_ATTR, this.locales.message(tooltip, [
            last - current, last, -first
        ]));
    }

    makeSprintBrush() {
        const num_sprints = this.max('num_sprints', this.state.sprints.limit);
        const future_sprints = this.hasFuture() ? this.max('future_sprints', 0) : 0;

        const last = Math.max(0,
            Math.min(this.state.sprints.last, num_sprints)
        );
        const first = Math.max(-future_sprints,
            Math.min(this.state.sprints.first, last)
        );
        const current = this.state.sprints.current === 0 ? first :
            this.state.sprints.current;

        const count = d3.select('#sprints-count')
            .call((element) => this.makeBrushTooltip(element,
                [first, current, last]
            ))
            .select('svg');
        const width = count.attr("width") - 32;
        const height = count.attr("height") - 16;

        const transform = this.state.formatter.selected === 'table' ?
            _.identity : _.reverse;
        const domain = [-future_sprints, num_sprints];
        const x = d3.scaleLinear()
            .domain(transform(domain))
            .rangeRound([0, width]);

        const axis = d3.axisBottom(x)
            .tickValues(
                this.makeSprintTicks(x, num_sprints, future_sprints, transform)
            )
            .tickFormat(
                d => this.formatSprintTick(d, -future_sprints, num_sprints)
            );

        const svg = count.select('g')
            .attr('transform', 'translate(16, 0)');
        svg.select('g.axis')
            .attr("transform", `translate(0, ${height})`)
            .call(axis);

        const brush = this.makeBrushTarget(width, height, x,
            () => !d3.event.button, transform,
            // Disallow selecting subset of future sprints that does not
            // start at the end time
            pos => pos[0] > 0 ?
                [Math.max(first, pos[0]), pos[0], Math.max(0, pos[1])] :
                [pos[0], 0, Math.max(0, pos[1])]
        );
        const disjointBrush = this.makeBrushTarget(width, height, x,
            () => !d3.event.button &&
                !d3.select(d3.event.target).classed('selection'),
            pos => this.clampFutureBrush(pos[0], pos[1], current, last)
        );

        svg.select('g.brush')
            .call(brush)
            .call(brush.move, transform([x(current), x(last)]));
        // Display another brush for disjoint future sprints
        const disjoint = svg.select('g.brush.disjoint')
            .classed('is-hidden', first === current)
            .call(disjointBrush)
            .call(disjointBrush.move, transform([x(first), x(0)]));
        disjoint.select('.overlay')
            .attr('pointer-events', 'none');
        disjoint.select('.selection')
            .attr('cursor', 'not-allowed');

        const future = transform([x(-future_sprints), x(0)]);
        svg.select('rect.future')
            .attr('x', future[0])
            .attr('width', future[1] - future[0]);
    }

    makeBrushTarget(width, height, x, filter, transform, url) {
        var current = [0, 0];
        const count = d3.select('#sprints-count');
        return d3.brushX()
            .extent([[0, 0], [width, height + 16]])
            .filter(() => filter())
            .on("start", () => {
                count.classed('is-tooltip-active', true);
            })
            .on("brush", () => {
                if (!d3.event.sourceEvent || !d3.event.selection) {
                    return;
                }
                const pos = transform(
                    d3.event.selection.map(x.invert).map(Math.round)
                );
                console.log(pos);
                if (!_.isEqual(pos, current)) {
                    current = pos;
                    this.makeBrushTooltip(count, url(current));
                }
            })
            .on("end", () => {
                count.classed('is-tooltip-active', false);
                if (!d3.event.sourceEvent || !d3.event.selection) {
                    return;
                }
                const pos = transform(
                    d3.event.selection.map(x.invert).map(Math.round)
                );
                window.location = getUrl(this.state, {
                    count: url(pos)
                });
            });
    }

    clampFutureBrush(start, end, current, last) {
        if (end < 0) {
            return [start - end, current, last];
        }
        if (start >= 0) {
            return [start, start, Math.max(end, last)];
        }
        return [start, end > current ? 0 : current, last];
    }

    makeSprintSelect() {
        const buttons = [
            {
                id: 'sprints-reset',
                icon: 'fas fa-history',
                active: state => true,
                url: state => getUrl(state, {
                    count: [0, 0, state.sprints.limit]
                })
            },
            {
                id: 'sprints-minus-one',
                icon: 'fas fa-minus',
                active: state => state.sprints.last > 0,
                url: state => getUrl(state, {
                    count: [
                        state.sprints.first, state.sprints.current,
                        state.sprints.last - 1
                    ]
                })
            },
            {
                id: 'sprints-plus-one',
                icon: 'fas fa-plus',
                active: state => state.sprints.last < this.max('num_sprints', state.sprints.limit),
                url: state => getUrl(state, {
                    count: [
                        state.sprints.first, state.sprints.current,
                        state.sprints.last + 1
                    ]
                })
            },
            {
                id: 'sprints-all',
                icon: 'fas fa-arrows-alt-h',
                active: state => state.sprints.last < this.max('num_sprints', state.sprints.limit),
                url: state => getUrl(state, {
                    count: [
                        Math.min(0, state.sprints.first), 0,
                        this.max('num_sprints', state.sprints.limit)
                    ]
                })
            },
            {
                id: 'sprints-future',
                icon: 'fas fa-ellipsis-h',
                active: state => this.hasFuture(),
                url: state => getUrl(state, {
                    count: [
                        this.hasFuture() ? -this.max('future_sprints', 0) : 0,
                        state.sprints.current,
                        state.sprints.last
                    ]
                })
            }
        ];

        const button = d3.select('#sprints-select')
            .selectAll('a')
            .data(buttons);
        const newButtons = button.enter()
            .append('a')
            .classed('button is-small tooltip', true)
            .attr('id', d => d.id)
            .attr(TOOLTIP_ATTR, d => this.locales.message(d.id))
            .attr(LABEL_ATTR, d => this.locales.message(d.id));
        newButtons.append('span')
            .classed('icon', true)
            .append('i')
            .attr('class', d => d.icon);
        button.merge(newButtons)
            .attr('disabled', d => d.active(this.state) ? null : true)
            .attr('href', d => d.active(this.state) ? d.url(this.state) : null);
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
            .attr(TOOLTIP_ATTR, d => this.locales.message(`sprint-meta-${this.state.sprint_meta.selected.has(d) ? "deselect" : "select"}`,
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
