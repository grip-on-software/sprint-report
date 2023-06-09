/**
 * Menu with selection options for number of sprints to display in the report.
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
import {addDrag, updateOrderTags} from './tabs';
import {getUrl, setToggle} from './url';
import {TOOLTIP_ATTR, LABEL_ATTR} from './attrs';

/**
 * The sprint selection within the configuration panel.
 */
export default class SprintSelection {
    constructor(state, localization, locales) {
        this.state = state;
        this.localization = localization;
        this.locales = locales;

        d3.select(window)
            .on("resize.sprint", () => requestAnimationFrame(() => {
                this.makeSprintBrush();
            }));
    }

    /**
     * Determine whether the future sprints should be displayed in the sprint
     * selection based on the support of the formatter, features, and sprints.
     */
    hasFuture() {
        return this.state.formatter.current !== null &&
            this.state.sprints.future > 0 &&
            this.state.formatter.current.requestConfig().future &&
            !this.state.features.selected
                .intersect(this.state.features.future).isEmpty();
    }

    /**
     * Determine a list of tick labels to display for the sprint selection, such
     * that they remain enough distance while being representative enough for
     * the range of sprints.
     */
    makeSprintTicks(x, numSprints, futureSprints, transform) {
        let ticks = x.ticks(Math.min(numSprints + futureSprints, 10));
        const tickDistance = Math.abs(x.invert(90) - x.invert(0));
        const futureDistance = Math.abs(x.invert(110) - x.invert(0));
        const ends = transform([
            ticks => [0, 1],
            ticks => [ticks.length - 1, -1]
        ]);
        const [future, futureDir] = ends[0](ticks);
        let futureCount = futureDir;
        while (ticks[future + futureCount] < 0 &&
            Math.abs(ticks[future + futureCount] + futureSprints) < futureDistance
        ) {
            futureCount += futureDir;
        }
        ticks.splice(Math.min(future, future + futureCount - futureDir),
            Math.abs(futureCount), -futureSprints
        );

        const [past, pastDir] = ends[1](ticks);
        let pastCount = pastDir;
        while (Math.abs(numSprints - ticks[past + pastCount]) < tickDistance) {
            pastCount += pastDir;
        }
        ticks.splice(Math.min(past, past + pastCount - pastDir),
            Math.abs(pastCount), numSprints
        );
        return ticks;
    }

    /**
     * Determine a more descriptive message for a certain tick, such as those
     * at the current sprint, the earliest sprint or the last future sprint.
     */
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

    /**
     * Determine the highest value among all projects for a numeric field.
     *
     * Valid names of the field are 'num_sprints' and 'future_sprints'. If there
     * are no selected projects with these values, then the `defaultValue` is
     * returned instead.
     */
    max(name, defaultValue) {
        const meta = _.maxBy(_.filter(this.state.projects.meta,
            p => this.state.projects.visible.includes(p.name)
        ), p => p[name]);
        if (!meta) {
            return defaultValue;
        }
        return meta[name];
    }

    /**
     * Create a tooltip above the sprint selection brush area, indicating what
     * the current range means for the selected sprints in a human-readable
     * message.
     */
    makeBrushTooltip(count, num) {
        let tooltip;
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

    /**
     * Create or update the sprint selection brush area.
     */
    makeSprintBrush() {
        const numSprints = this.max('num_sprints', this.state.sprints.limit);
        const futureSprints = this.hasFuture() ? this.max('future_sprints', 0) : 0;

        const last = Math.max(0,
            Math.min(this.state.sprints.last, numSprints)
        );
        const first = Math.max(-futureSprints,
            Math.min(this.state.sprints.first, last)
        );
        const current = this.state.sprints.current === 0 ? first :
            this.state.sprints.current;

        const count = d3.select('#sprints-count')
            .call((element) => this.makeBrushTooltip(element,
                [first, current, last]
            ))
            .select('svg');
        const width = Math.min(500,
            count.node().parentNode.parentNode.clientWidth / 2
        );
        count.attr("width", width);
        const height = count.attr("height") - 16;

        const transform = this.state.formatter.selected === 'table' ?
            _.identity : _.reverse;
        const domain = transform([-futureSprints, numSprints]);
        const x = d3.scaleLinear()
            .domain(domain)
            .rangeRound([0, width]);

        const axis = d3.axisBottom(x)
            .tickValues(
                this.makeSprintTicks(x, numSprints, futureSprints, transform)
            )
            .tickFormat(
                d => this.formatSprintTick(d, -futureSprints, numSprints)
            );

        const svg = count.select('g');
        svg.select('g.axis')
            .attr("transform", `translate(0, ${height})`)
            .call(axis);

        const brush = this.makeBrushTarget(width, height, {
            x, transform,
            filter: () => !d3.event.button,
            // Disallow selecting subset of future sprints that does not
            // start at the end time
            url: pos => pos[0] > 0 ?
                [Math.max(first, pos[0]), pos[0], Math.max(0, pos[1])] :
                [pos[0], 0, Math.max(0, pos[1])]
        });
        const disjointBrush = this.makeBrushTarget(width, height, {
            x, transform,
            filter: () => !d3.event.button &&
                !d3.select(d3.event.target).classed('selection'),
            url: pos => this.clampFutureBrush(pos[0], pos[1], current, last),
        });

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

        const future = transform([x(-futureSprints), x(0)]);
        svg.select('rect.future')
            .attr('x', future[0])
            .attr('width', future[1] - future[0]);
    }

    /**
     * Create a subarea within the sprint selection brush area that can be
     * selected as a contiguous range.
     */
    makeBrushTarget(width, height, callbacks) {
        let current = [0, 0];
        const count = d3.select('#sprints-count');
        return d3.brushX()
            .extent([[0, 0], [width, height + 16]])
            .filter(() => callbacks.filter())
            .on("start", () => {
                count.classed('has-tooltip-active', true);
            })
            .on("brush", () => {
                if (!d3.event.sourceEvent || !d3.event.selection) {
                    return;
                }
                const pos = callbacks.transform(
                    d3.event.selection.map(callbacks.x.invert).map(Math.round)
                );
                if (!_.isEqual(pos, current)) {
                    current = pos;
                    this.makeBrushTooltip(count, callbacks.url(current));
                }
            })
            .on("end", () => {
                count.classed('has-tooltip-active', false);
                if (!d3.event.sourceEvent || !d3.event.selection) {
                    return;
                }
                const pos = callbacks.transform(
                    d3.event.selection.map(callbacks.x.invert).map(Math.round)
                );
                window.location = getUrl(this.state, {
                    count: callbacks.url(pos)
                });
            });
    }

    /**
     * Make an adjusted sprint selection based on the disjoint future brush.
     */
    clampFutureBrush(start, end, current, last) {
        if (end < 0) {
            return [start - end, current, last];
        }
        if (start >= 0) {
            return [start, start, Math.max(end, last)];
        }
        return [start, end > current ? 0 : current, last];
    }

    /**
     * Create or update the buttons in the sprint selection that allow the
     * selection to be adjusted by steps or as a whole.
     */
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
            .classed('button is-small is-outlined is-light has-text-grey-darker tooltip', true)
            .attr('id', d => d.id)
            .attr('role', 'button')
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

    /**
     * Create or update the filter checkbox that determines if open sprints are
     * included in the report.
     */
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

    /**
     * Create or update the sprint metadata field selection.
     */
    makeSprintMeta() {
        const meta = d3.select('#sprints-meta ul').selectAll('li').data(
            _.concat(['sprint-meta-header'], this.state.sprint_meta.known),
            function(d) {
                return d || this.id;
            }
        );
        const newMeta = meta.enter().append('li');
        const label = newMeta.append('a')
            .classed('tooltip has-tooltip-multiline has-tooltip-center', true);
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
