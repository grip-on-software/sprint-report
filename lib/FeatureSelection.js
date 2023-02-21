/**
 * Menu with options to select features to display in the sprint report.
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
import {OrderedSet} from 'immutable';
import {vsprintf} from 'sprintf-js';
import {addDrag, updateOrderTags} from './tabs';
import {getUrl, setToggle} from './url';
import {TOOLTIP_ATTR, LABEL_ATTR} from './attrs';

const PANEL_HEADING = '.panel-heading';

/**
 * The feature selection within the configuration panel.
 */
export default class FeatureSelection {
    constructor(state, localization, locales) {
        this.state = state;
        this.localization = localization;
        this.locales = locales;
    }

    /**
     * Adjust the item in the feature selection to have a tooltip with a longer
     * description or expression of the feature, if available.
     */
    setFeatureTooltip(d, link) {
        let description = this.locales.retrieve(this.localization.long_descriptions,
            d, ""
        );
        const assignment = this.state.features.format.assignment(d);
        if (assignment !== null && !_.includes(assignment, "(")) {
            description = description !== "" ?
                this.locales.message("features-tooltip-assignment", [
                    description, assignment
                ]) : assignment;
        }
        link.attr(TOOLTIP_ATTR, description)
            .classed('tooltip has-tooltip-multiline has-tooltip-center',
                description !== ""
            );
    }

    /**
     * Determine if a feature should be placed behind a "More" option within
     * the category of features, because it is less likely to be useful within
     * the current context or confusing to the user.
     */
    isHidden(d, formatter) {
        if (this.state.features.selected.has(d)) {
            return false;
        }
        if (!formatter.required &&
            _.has(this.localization.metadata.preferred, d)
        ) {
            return !this.localization.metadata.preferred[d];
        }
        return !_.some(formatter.features, group => group.startsWith('!') ?
            !this.state.features[group.slice(1)].has(d) :
            this.state.features[group].has(d)
        );
    }

    /**
     * Create or update categories of features within the selection.
     */
    makeFeatureCategories() {
        const categories = d3.select('#features').selectAll('.columns')
            .data(_.filter(this.localization.categories,
                d => !_.isEmpty(d.items)
            ));

        const newCategories = categories.enter()
            .append('div').classed('columns', true);
        const name = newCategories.append('div')
            .classed('column category tooltip', true);
        name.attr(TOOLTIP_ATTR,
            d => this.locales.message("features-category-hide",
                [this.locales.retrieve(d)]
            )
        );
        name.on("click", (d, i, nodes) => {
            const tabs = d3.select(nodes[i].parentNode).select('.tabs');
            const hidden = tabs.classed("is-hidden");
            tabs.classed("is-hidden", false).style("height", null);
            const height = tabs.node().clientHeight;
            tabs.style("opacity", hidden ? 0 : 1)
                .style("height", hidden ? '0px' : `${height}px`)
                .transition()
                .style("opacity", hidden ? 1 : 0)
                .style("height", hidden ? `${height}px` : '0px')
                .on("end", () => {
                    tabs.classed("is-hidden", !hidden);
                    d3.select(nodes[i]).classed("is-size-7", !hidden)
                        .attr(TOOLTIP_ATTR, this.locales.message(`features-category-${hidden ? "hide" : "show"}`,
                            [this.locales.retrieve(d)]
                        ))
                        .select(".icon").classed("is-small", !hidden)
                        .select("i").classed("fa-sm", !hidden);
                });
        });
        name.append('span')
            .classed('icon', true)
            .append('i')
            .attr('class', d => d.icon.join(' '));
        name.append('span')
            .classed('name', true)
            .text(d => this.locales.retrieve(d));

        newCategories.append('div')
            .classed('column features', true)
            .append('div')
            .classed('tabs is-toggle is-size-7', true)
            .append('ul');

        const formatter = _.find(this.state.formatter.known,
            {name: this.state.formatter.selected}
        );
        const updateCategories = newCategories.merge(categories);
        const tabs = updateCategories.selectAll('.features .tabs ul');
        const features = tabs.selectAll('li.item')
            .data(d => d.items);

        const newFeatures = features.enter()
            .append('li')
            .classed('item', true);
        const label = newFeatures.append('a');
        label.each(
            (d, i, nodes) => this.setFeatureTooltip(d, d3.select(nodes[i]))
        );
        label.append('span')
            .classed('feature', true)
            .text(d => this.locales.retrieve(this.localization.descriptions, d));
        label.append('span').classed('tag', true);
        label.append('span')
            .classed('icon is-small is-hidden', true)
            .append('i');
        addDrag(this.state, label, {
            name: "feature",
            items: this.state.features,
            key: d => d
        });

        const mores = tabs.selectAll('li.more')
            .data(d => [{
                category: d,
                message: 'more',
                formatter: this.state.formatter.selected
            }], d => `${d.formatter}-${d.category}-${d.message}`);
        mores.exit().remove();

        const updateFeatures = newFeatures.merge(features)
            .classed('is-hidden', (d, i, nodes) => {
                const more = d3.select(nodes[i].parentNode)
                    .selectAll('li.more');
                return (more.empty() || !more.classed('is-hidden')) &&
                    this.isHidden(d, formatter);
            })
            .classed('is-active', d => this.state.features.selected.has(d));
        updateFeatures.filter(':not(.is-hidden)')
            .classed('is-first', (d, i) => i === 0)
            .classed('is-last', (d, i, nodes) => i === nodes.length - 1);
        updateFeatures.selectAll('a')
            .attr('href', d => getUrl(this.state, {
                feature: _.assign({}, this.state.features, {
                    selected: setToggle(this.state.features.selected, d)
                })
            }));
        updateFeatures.selectAll('.icon i')
            .attr('class', (d, i, nodes) => {
                const team = this.state.features.team.has(d);
                const project = this.state.features.project.has(d);
                let classes = null;
                if (team && !project) {
                    classes = 'fas fa-users fa-sm';
                }
                if (project && !team) {
                    classes = 'fas fa-sitemap fa-sm';
                }
                d3.select(nodes[i].parentNode)
                    .classed('is-hidden', classes === null);
                return classes;
            });

        updateOrderTags(updateFeatures, this.state.features, d => d);

        this.updateMore(mores);
    }

    /**
     * Update the "More" options within categories of the feature selection that
     * can be clicked to show less prominent features.
     */
    updateMore(more) {
        const newMore = more.enter()
            .append('li')
            .classed('more', true);
        newMore.append('button')
            .classed('button is-text is-size-7 tooltip', true)
            .text(d => this.locales.message(`features-${d.message}`))
            .attr(TOOLTIP_ATTR,
                d => this.locales.message(`features-${d.message}-tooltip`,
                    [this.locales.retrieve(d.category)]
                )
            )
            .on('click', (d, i, nodes) => {
                d3.select(nodes[i].parentNode.parentNode)
                    .selectAll('li.item')
                    .classed('is-hidden', false)
                    .classed('is-first', (d, i) => i === 0)
                    .classed('is-last', (d, i, nodes) => i === nodes.length - 1);
                d3.select(nodes[i].parentNode).classed('is-hidden', true);
            });
        newMore.merge(more).classed('is-hidden',
            (d, i, nodes) => d3.select(nodes[i].parentNode.parentNode)
                .select('li.item.is-hidden').empty()
        );
    }

    /**
     * Adjust the display of the feature selection to display the categories or
     * to hide them such that only the panel of current features is shown.
     */
    toggleFeatureSelection(selection, panel, visible=null, duration=500) {
        const t = d3.transition("feature-selection").duration(duration);
        const hidden = selection.classed('is-hidden');
        const features = d3.selectAll('#features .columns');
        if (visible !== null && hidden !== visible) {
            return;
        }
        if (hidden) {
            features.select('.selection').remove();
            selection.classed('is-hidden', false);
        }
        selection.selectAll('.panel-block, .tabs')
            .classed('is-hidden', false)
            .style('opacity', hidden ? 0 : 1)
            .transition(t)
            .style('opacity', hidden ? 1 : 0);
        features.selectAll('.column:not(.selection)')
            .classed('is-hidden', false)
            .style('opacity', hidden ? 0 : 1)
            .transition(t)
            .style('opacity', hidden ? 1 : 0);
        selection.transition(t).on('end', () => {
            panel.select(PANEL_HEADING)
                .attr('aria-expanded', hidden ? 'true' : 'false')
                .attr(LABEL_ATTR, this.locales.message(`features-selection-${hidden ? "collapse" : "expand"}`))
                .select('i')
                .attr('class', `far fa-${hidden ? "minus" : "plus"}-square`);
            selection.selectAll('.panel-block, .tabs')
                .classed('is-hidden', !hidden);
            features.selectAll('.column:not(.selection)')
                .classed('is-hidden', !hidden);
            if (!hidden) {
                d3.select('#features .columns')
                    .append('div')
                    .classed('column selection is-narrow', true)
                    .append(() => panel.node().cloneNode(true))
                    .select(PANEL_HEADING)
                    .on('click', () => this.toggleFeatureSelection(selection, panel));
            }
            selection.classed('is-hidden', !hidden);
        });
    }

    /**
     * Create or update the panel of selected features.
     */
    makeSelectedFeatures() {
        const selection = d3.select('#feature-selection');
        const panel = selection.select('.panel');
        panel.select(PANEL_HEADING)
            .attr(LABEL_ATTR, this.locales.message('features-selection-collapse'))
            .attr('role', 'button')
            .on('click', () => this.toggleFeatureSelection(selection, panel));
        const selectedFeatures = panel.selectAll('.panel-block')
            .data(Array.from(this.state.features.selected));
        selectedFeatures.exit().remove();
        const newSelection = selectedFeatures.enter()
            .append('label')
            .classed('panel-block', true);
        newSelection.append('span')
            .classed('order panel-icon', true);
        newSelection.append('span')
            .classed('feature', true);
        addDrag(this.state, newSelection, {
            name: "feature",
            items: this.state.features,
            key: d => d,
            relative: panel.node()
        });
        this.toggleFeatureSelection(selection, panel, this.state.features.changed, 0);
        const updateSelection = newSelection.merge(selectedFeatures).order();
        updateSelection.select('.order')
            .text((d, i) => `${i + 1}.`);
        updateSelection.select('.feature')
            .text(d => this.locales.retrieve(this.localization.descriptions, d))
            .each(
                (d, i, nodes) => this.setFeatureTooltip(d, d3.select(nodes[i]))
            );
        const icons = updateSelection.selectAll('.icon')
            .data((d, i) => [
                {
                    type: 'remove',
                    name: d,
                    classes: 'has-tooltip-danger',
                    icon: 'far fa-times-circle'
                },
                {
                    type: 'visibility',
                    options: ['visible', 'team', 'project', 'hidden'],
                    option: _.find([
                        ['team', 'project'], ['project', 'team'], ['visible'], ['all']
                    ], option => this.state.features[option[0]].includes(d) &&
                        (option.length === 1 || !this.state.features[option[1]].includes(d))
                    )[0],
                    name: d,
                    update: {
                        visible: features => _.assign(features, {
                            visible: features.visible.add(d)
                        }),
                        team: features => _.assign(features, {
                            project: features.project.remove(d),
                            team: features.team.add(d)
                        }),
                        project: features => _.assign(features, {
                            team: features.team.remove(d),
                            project: features.project.add(d)
                        }),
                        hidden: features => _.assign(features, {
                            visible: features.visible.remove(d)
                        })
                    },
                    icons: {
                        visible: 'fas fa-eye',
                        team: 'fas fa-users',
                        project: 'fas fa-sitemap',
                        hidden: 'fas fa-eye-slash'
                    }
                },
                {
                    type: 'up',
                    swap: i - 1,
                    name: d,
                    icon: 'fas fa-arrow-up'
                },
                {
                    type: 'down',
                    swap: i + 1,
                    name: d,
                    icon: 'fas fa-arrow-down'
                }
            ]);
        icons.exit().remove();
        const newIcon = icons.enter().append('a')
            .classed('icon panel-icon tooltip', true);
        newIcon.append('i');
        this.updateIcons(newIcon.merge(icons));

        const selectionButtons = selection.select('.tabs ul')
            .selectAll('li')
            .data([
                {
                    features: () => this.state.features.default
                        .subtract(this.state.features.meta),
                    message: 'reset',
                    classes: 'is-warning tooltip'
                },
                {
                    features: () => OrderedSet(),
                    message: 'clear',
                    classes: 'is-danger tooltip'
                }
            ]);
        selectionButtons.enter()
            .append('li')
            .append('a')
            .attr('class', d => d.classes)
            .attr(TOOLTIP_ATTR, d => this.locales.message(`features-select-${d.message}-tooltip`))
            .text(d => this.locales.message(`features-select-${d.message}`))
            .merge(selection.selectAll('.tabs ul a'))
            .attr('href', d => getUrl(this.state, {
                feature: d.features(this.state.features)
            }));
    }

    /**
     * Adjust the icons displayed in the rows of the feature selection panel
     * to indicate their state.
     */
    updateIcons(icons) {
        icons.attr('class', d => {
                let classes = ['icon', 'panel-icon', 'tooltip'];
                if (d.classes) {
                    classes = _.concat(classes,
                        d.options ? d.classes[d.option] : d.classes
                    );
                }
                return _.join(classes, ' ');
            })
            .attr('role', 'button')
            .attr(TOOLTIP_ATTR,
                d => this.locales.attribute('feature-selection-tooltip',
                    d.options ? `${d.type}-${d.option}` : d.type
                )
            )
            .attr(LABEL_ATTR, d => {
                const f = this.locales.retrieve(this.localization.descriptions,
                    d.name
                );
                const label = vsprintf(
                    this.locales.attribute('feature-selection-label',
                        d.options ? `${d.type}-${d.option}` : d.type
                    ),
                    [f]
                );
                if (d.options) {
                    const next = d.options[(_.findIndex(d.options,
                        option => option === d.option) + 1
                    ) % d.options.length];
                    const t = this.locales.attribute('feature-selection-toggle',
                        `${d.type}-${next}`
                    );
                    return `${label} ${t}`;
                }
                return label;
            })
            .attr('href', (d, i) => this.getIconUrl(d))
            .classed('is-disabled', d => !d.options &&
                (d.swap < 0 || d.swap >= this.state.features.selected.size)
            )
            .on('mousedown touchstart', () => {
                d3.event.stopPropagation();
            })
            .select('i')
            .attr('class', d => {
                if (d.options) {
                    return d.icons[d.option];
                }
                return d.icon;
            });
    }

    /**
     * Generate a navigable URL for an icon in the feature selection panel,
     * which reflects what changes would happen if the icon is clicked.
     */
    getIconUrl(d) {
        let features = _.assign({}, this.state.features);
        if (d.options) {
            const current = d.option;
            const next = d.options[(_.findIndex(d.options,
                option => option === d.option) + 1
            ) % d.options.length];
            features[current] = features[current].delete(d.name);
            features = d.update[next](features);
        }
        else if (d.type === 'remove') {
            features.selected = features.selected.delete(d.name);
        }
        else {
            const selected = Array.from(features.selected);
            if (d.swap < 0 || d.swap >= selected.length) {
                return null;
            }
            const other = selected[d.swap];
            const swap = _.fromPairs([[d.name, other], [other, d.name]]);
            features.selected = OrderedSet(_.map(selected,
                name => swap[name] || name
            ));
        }
        return getUrl(this.state, {
            feature: features
        });
    }
}
