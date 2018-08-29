import _ from 'lodash';
import * as d3 from 'd3';
import axios from 'axios';
import {OrderedMap, OrderedSet, Seq} from 'immutable';
import {navigation} from '@gros/visualization-ui';
import format from './format';
import exports from './export';

const setToggle = function(set, value) {
    if (set.has(value)) {
        return set.delete(value);
    }
    return set.add(value);
};

const findTabs = (container) => {
    const view = d3.mouse(document.body);
    const viewX = view[0] - (document.documentElement.scrollLeft || document.body.scrollLeft);
    const viewY = view[1] - (document.documentElement.scrollTop || document.body.scrollTop);
    if (typeof document.elementsFromPoint === "function") {
        return d3.selectAll(document.elementsFromPoint(viewX, viewY))
            .filter('a:not(.dragging)');
    }
    return d3.select(container).selectAll('a:not(.dragging)').filter(function() {
        const rect = this.getBoundingClientRect();
        return rect.left <= viewX && viewY <= rect.left + rect.width &&
            rect.top <= viewY && viewY <= rect.top + rect.height;
    });
};

const updateOrderTags = (element, items, key) => {
    const order = _.zipObject(Array.from(items.selected),
        _.range(1, items.selected.size + 1)
    );
    element.selectAll('span.tag')
        .classed('is-hidden', d => !order[key(d)])
        .text(d => order[key(d)] || null);
};

class builder {
    constructor(projects, features, locales, moment, localization, sprints, spinner) {
        this.projects = {
            known: _.map(projects, "name"),
            meta: projects,
            selected: OrderedSet()
        };
        this.projects.display_names = _.zipObject(this.projects.known,
            _.map(projects, (meta) =>
                meta.name !== meta.quality_display_name ?
                meta.quality_display_name : null
            )
        );

        this.features = features;
        this.features.known = _.difference(this.features.all,
            this.features.meta
        );
        this.features.selected = OrderedSet(_.difference(this.features.default,
            this.features.meta
        ));

        this.locales = locales;
        this.moment = moment;
        this.localization = localization;

        this.formatter = {
            selected: "table",
            current: null,
            known: [
                {
                    name: "table",
                    class: "Table",
                    icon: ["fas", "fa-table"]
                },
                {
                    name: "line_chart",
                    class: "LineChart",
                    icon: ["fas", "fa-chart-line"]
                },
                {
                    name: "bar_chart",
                    class: "BarChart",
                    icon: ["fas", "fa-chart-bar"]
                }
            ]
        };
        this.formatter.classes = _.fromPairs(_.map(this.formatter.known,
            (formatter) => [formatter.name, format[formatter.class]]
        ));

        this.exporter = {
            known: [
                {
                    name: "csv",
                    class: "CSV",
                    icon: ["fas", "fa-th"]
                },
                {
                    name: "json",
                    class: "JSON",
                    icon: ["fas", "fa-shapes"]
                },
                {
                    name: "html",
                    class: "HTML",
                    icon: ["fas", "fa-code"]
                },
                {
                    name: "link",
                    class: "Link",
                    icon: ["fas", "fa-link"]
                },
                {
                    name: "print",
                    class: "Print",
                    icon: ["fas", "fa-print"]
                }
            ]
        };
        this.exporter.classes = _.fromPairs(_.map(this.exporter.known,
            (exporter) => [exporter.name, exports[exporter.class]]
        ));

        this.sprints = _.assign({}, sprints, {
            current: sprints.limit,
            showOld: false,
            closedOnly: false
        });

        this.sprint_meta = {
            known: ['sprint_name', 'sprint_num', 'close_date'],
            numeric: OrderedSet(['sprint_num']),
            changed: false,
            format: {
                sprint_name: (d) => d,
                sprint_num: (d) => this.locales.message('sprint-number', [d]),
                start_date: (d, node) => this.formatDate(d, node, "start_date"),
                close_date: (d, node) => this.formatDate(d, node, "close_date")
            }
        };
        this.sprint_meta.selected = OrderedSet(this.sprint_meta.known);

        this.navigationHooks = {
            feature: (features) => {
                this.features.selected = OrderedSet(_.intersection(features,
                    this.features.known
                ));
            },
            format: (formatter) => {
                if (formatter[0] !== this.formatter.selected &&
                    _.some(this.formatter.known,
                        format => format.name === formatter[0]
                    )
                ) {
                    this.formatter.selected = formatter[0];
                    this.formatter.current = null;
                }
            },
            count: (num) => {
                this.sprints.current = num[0];
            },
            closed: (closed) => {
                this.sprints.closedOnly = closed[0] === '1';
            },
            old: (old) => {
                this.sprints.showOld = old[0] === '1';
            },
            meta: (meta) => {
                const sprint_meta = OrderedSet(_.intersection(meta,
                    this.sprint_meta.known
                ));
                if (!sprint_meta.equals(this.sprint_meta.selected)) {
                    this.sprint_meta.selected = sprint_meta;
                    this.sprint_meta.changed = true;
                }
            }
        };

        this.spinner = spinner;
    }

    formatDate(data, node, key) {
        const date = this.moment(data, "YYYY-MM-DD HH:mm:ss", true);
        const description = this.locales.attribute("sprint_meta", key);
        node.attr('title', this.locales.message("date-title",
            [description, date.format()]
        ));

        return date.format('ll');
    }

    getUrl(selections) {
        const parts = _.assign({}, {
            project: this.projects.selected,
            feature: this.features.selected,
            meta: this.sprint_meta.selected,
            format: [this.formatter.selected],
            count: [this.sprints.current],
            closed: [this.sprints.closedOnly ? '1' : '0'],
            old: [this.sprints.showOld ? '1': '0']
        }, selections);

        const formatPart = (key, values) => `${key}_${values.join(',')}`;
        var accumulator = [formatPart("project", parts.project)];
        return `#${_.transform(parts, (accumulator, values, key) => {
            if (key !== "project") {
                accumulator.push(formatPart(key, values));
            }
        }, accumulator).join('|')}`;
    }

    makeConfiguration() {
        this.makeToggle();
        this.makeProjectNavigation();
        this.makeSprintSelection();
        this.makeFeatureSelection();
        this.makeFormatSelection();
        this.makeExportOptions();
    }

    makeToggle() {
        const hide = this.locales.message("config-hide"),
              show = this.locales.message("config-show");
        d3.selectAll('#options .toggle')
            .classed('tooltip', true)
            .datum(function() {
                return this.dataset;
            })
            .attr('data-tooltip', d => {
                const hidden = d3.select(`#${d.toggle}`).classed('is-hidden');
                return this.locales.message(`${d.toggle}-${hidden ? "show" : "hide"}`);
            })
            .on('click', (d, i, nodes) => {
                const config = d3.select(`#${d.toggle}`);
                const hidden = config.classed('is-hidden');
                config.classed('is-hidden', false)
                    .style('opacity', hidden ? 0 : 1)
                    .transition()
                    .style('opacity', hidden ? 1 : 0)
                    .on("end", function() {
                        d3.select(this).classed('is-hidden', !hidden);
                    });
                d3.select(nodes[i])
                    .attr('data-tooltip', this.locales.message(`${d.toggle}-${hidden ? "hide" : "show"}`))
                    .select('i')
                    .classed(d.shown, hidden)
                    .classed(d.hidden, !hidden);
            });
    }

    buildProjectFilter(projectNavigation, selections) {
        const isRecent = _.every(this.projects.meta,
            (project) => this.projects.selected.has(project.name) ?
                project.recent : true
        );
        const filter = (projects) => {
            const filters = {};
            d3.selectAll('#project-filter input').each(function(d) {
                const checked = d3.select(this).property('checked');
                const bits = d.inverse ? [d.inverse, !checked] : [d.key, checked];
                if (bits[1]) {
                    filters[bits[0]] = true;
                }
            });

            return _.filter(projects, filters);
        };

        const projectFilter = () => _.concat(selections,
            filter(this.projects.meta)
        );

        const label = d3.select('#project-filter')
            .selectAll('label')
            .data([
                {key: 'recent', default: !!isRecent},
                {key: 'support', inverse: 'core', default: false}
            ])
            .enter()
            .append('label')
            .classed('checkbox', true);
        label.append('input')
            .attr('type', 'checkbox')
            .property('checked', d => d.default)
            .on('change', () => projectNavigation.update(projectFilter()));
        label.append('span')
            .text(d => this.locales.attribute("project-filter", d.key))
            .attr('title', d => this.locales.attribute("project-filter-title", d.key));

        return projectFilter;
    }

    makeProjectNavigation() {
        // Create project navigation
        var knownProjects = new Set(this.projects.known);
        const isActive = (key) => this.projects.selected.has(key);
        const updateProjects = (element, list) => {
            const order = _.zipObject(Array.from(this.projects.selected),
                _.range(1, this.projects.selected.size + 1)
            );
            element.each(function() {
                d3.select(this.parentNode)
                    .classed('is-active', d => isActive(d.name));
            });
            element.attr('title', d => d.title ||
                    this.locales.message(`project-title-${isActive(d.name) ? "remove" : "add"}`,
                        [d.quality_display_name]
                    )
                )
                .attr('href', d => {
                    return this.getUrl({project: (d.projects ?
                        d.projects(list.merge(list.enter())) :
                        setToggle(OrderedSet(this.projects.selected), d.name)
                    )});
                });
            element.select('span.project').text(d => d.message || d.name);
            updateOrderTags(element, this.projects, d => d.name);
        };
        const setCurrentItem = (project) => {
            const parts = project.split('|');

            _.forEach(parts, (value, index) => {
                if (index === 0) {
                    this.projects.selected = OrderedSet(value.split(','))
                        .intersect(knownProjects);
                }
                else {
                    const sep = value.indexOf('_');
                    const name = value.substr(0, sep);
                    const values = value.substr(sep + 1).split(',');
                    if (this.navigationHooks[name]) {
                        this.navigationHooks[name](values);
                    }
                }
            });
        };
        const updateSelection = () => {
            const list = d3.selectAll('#navigation ul li');
            list.selectAll('a')
                .call(updateProjects, list);
            this.makeSprintSelection();
            this.makeFeatureSelection();
            this.makeFormatSelection();
            this.makeFormat();
        };
        const projectNavigation = new navigation({
            container: '#navigation',
            prefix: 'project_',
            key: d => d.name,
            isActive,
            setCurrentItem: (project, hasProject) => {
                setCurrentItem(project);
                updateSelection();
                return true;
            },
            addElement: (element) => {
                element.append('span').classed('project', true);
                element.append('span').classed('tag', true);

                updateProjects(element, d3.selectAll('#navigation ul li'));
                element.style("width", "0%")
                    .style("opacity", "0")
                    .transition()
                    .style("width", "100%")
                    .style("opacity", "1");

                this.addDrag(element, {
                    name: "project",
                    items: this.projects,
                    key: d => d.name
                });
            },
            updateElement: (element) => {
                updateProjects(element.selectAll('a'), element);
            },
            removeElement: (element) => {
                element.transition()
                    .style("opacity", "0")
                    .remove();
            }
        });

        // Select projects to let the filter know if we selected a project that
        // would be filtered by default.
        setCurrentItem(window.location.hash);
        const projectFilter = this.buildProjectFilter(projectNavigation, [
            {
                name: "*",
                display_name: null,
                message: this.locales.message("projects-select-all"),
                title: this.locales.message("projects-select-all-title"),
                projects: (list) => OrderedSet(_.map(
                    _.filter(list.data(), project => !project.projects),
                    project => project.name
                ))
            },
            {
                name: "",
                display_name: null,
                message: this.locales.message("projects-deselect"),
                title: this.locales.message("projects-deselect-title"),
                projects: () => OrderedSet()
            }
        ]);
        projectNavigation.start(projectFilter());
    }

    addDrag(element, config) {
        element.call(d3.drag()
            .filter(d => config.items.selected.has(config.key(d)))
            .subject(() => {return {x: d3.event.x, y: d3.event.y};})
            .on("start", (d, i, nodes) => {
                d3.select(nodes[i]).classed("drag", true);
                const initial = d3.mouse(nodes[i]);
                d3.event.on("drag", (d, i, nodes) => {
                    d3.select(nodes[i])
                        .classed("dragging", true)
                        .style("left", `${d3.event.x - initial[0]}px`)
                        .style("top", `${d3.event.y - initial[1]}px`);
                })
                .on("end", (d, i, nodes) => {
                    const dropTab = d3.select(findTabs(nodes[i].parentNode.parentNode).node());
                    d3.select(nodes[i])
                        .classed("drag dragging", false)
                        .transition()
                        .duration(200)
                        .ease(d3.easeLinear)
                        .style("left", "0px")
                        .style("top", "0px");
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
                    window.location = this.getUrl(_.fromPairs([[config.name,
                        _.map(Array.from(config.items.selected),
                            name => name === drag ? drop :
                                name === drop ? drag : name
                        )
                    ]]));
                });
            })
        );
    }

    makeSprintSelection() {
        const input = d3.select('#sprints-count input')
            .attr('max', this.sprints.limit)
            .property('value', this.sprints.current);
        const output = d3.select('#sprints-count output')
            .text(this.sprints.current);

        input.on('input.output', () => {
            output.text(input.property('value'));
            window.location = this.getUrl({
                count: [input.property('value')]
            });
        });

        const onlyClosed = this.sprints.closed ? true : null;
        const closed = d3.select('#sprints-closed label')
            .attr('disabled', onlyClosed)
            .select('input')
            .attr('disabled', onlyClosed)
            .attr('checked', onlyClosed || this.sprints.closedOnly ? true : null)
            .on('change.close', () => {
                window.location = this.getUrl({
                    closed: [closed.property('checked') ? '1' : '0']
                });
            });

        const onlyRecent = this.sprints.old ? null : true;
        const old = d3.select('#sprints-old label')
            .attr('disabled', onlyRecent)
            .select('input')
            .attr('disabled', onlyRecent)
            .attr('checked', this.sprints.showOld ? true : null)
            .on('change.old', () => {
                window.location = this.getUrl({
                    count: [this.sprints.limit],
                    old: [old.property('checked') ? '1' : '0']
                });
            });

        const meta = d3.select('#sprints-meta ul').selectAll('li')
            .data(this.sprint_meta.known);
        const newMeta = meta.enter().append('li');
        const label = newMeta.append('a');
        label.append('span')
            .classed('meta', true)
            .text(d => this.locales.attribute("sprint_meta", d));
        label.append('span').classed('tag', true);
        this.addDrag(label, {
            name: "meta",
            items: this.sprint_meta,
            key: d => d
        });

        const updateMeta = newMeta.merge(meta)
            .classed('is-active', d => this.sprint_meta.selected.has(d));
        updateMeta.selectAll('a')
            .attr('href', d => this.getUrl({
                meta: setToggle(this.sprint_meta.selected, d)
            }));
        updateMeta.selectAll('input')
            .property('checked', d => this.sprint_meta.selected.has(d));

        updateOrderTags(updateMeta, this.sprint_meta, d => d);
    }

    makeFeatureSelection() {
        const features = d3.select('#features ul').selectAll('li')
            .data(this.features.known);
        const newFeatures = features.enter()
            .append('li');
        const label = newFeatures.append('a');
        label.append('span')
            .classed('feature', true)
            .text(d => this.locales.retrieve(this.localization.descriptions, d));
        label.append('span').classed('tag', true);
        this.addDrag(label, {
            name: "feature",
            items: this.features,
            key: d => d
        });

        const updateFeatures = newFeatures.merge(features)
            .classed('is-active', d => this.features.selected.has(d));
        updateFeatures.selectAll('a')
            .attr('href', d => this.getUrl({
                feature: setToggle(this.features.selected, d)
            }));

        updateOrderTags(updateFeatures, this.features, d => d);
    }

    makeFormatSelection() {
        const formats = d3.select('#format ul').selectAll('li')
            .data(this.formatter.known);
        const newFormats = formats.enter()
            .append('li');
        const label = newFormats.append('a');
        label.append('span')
            .classed('icon', true)
            .append('i')
            .attr('class', d => d.icon.join(' '));
        label.append('span')
            .text(d => this.locales.attribute("formats", d.name));

        newFormats.merge(formats)
            .classed('is-active', d => d.name === this.formatter.selected)
            .selectAll('a')
            .attr('href', d => this.getUrl({
                format: [d.name]
            }));
    }

    makeFormat() {
        if (this.formatter.current === null) {
            this.formatter.current = new this.formatter.classes[this.formatter.selected](this.locales, this.localization);
        }
        this.formatter.current.build({
            projects: this.projects,
            features: this.features,
            sprints: this.sprints,
            sprint_meta: this.sprint_meta
        }, this.spinner);
    }

    makeExportOptions() {
        const button = d3.select('#export')
            .selectAll('button')
            .data(this.exporter.known)
            .enter()
            .append('button')
            .classed('button', true)
            .attr('id', d => `export-${d.name}`);
        button.append('span')
            .classed('icon', true)
            .append('i')
            .attr('class', d => d.icon.join(' '));
        button.append('span')
            .text(d => this.locales.attribute('exports', d.name));
        button.on('click', (d, i, nodes) => {
            const activeButton = d3.select(nodes[i])
                .classed('is-loading', true);
            const exporter = new this.exporter.classes[d.name](this.locales,
                this.localization,
                {
                    projects: this.projects,
                    features: this.features,
                    sprints: this.sprints,
                    sprint_meta: this.sprint_meta
                }
            );
            exporter.build(activeButton);
        });
    }
}

export default builder;
