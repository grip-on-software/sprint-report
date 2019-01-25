import _ from 'lodash';
import * as d3 from 'd3';
import axios from 'axios';
import {sankey, sankeyLinkHorizontal} from 'd3-sankey';
import {OrderedSet} from 'immutable';
import {unwrapFeature, filterSprints, sprintsToFeatures} from '../data';
import {Chart, linspace} from './Chart';

export default class SankeyChart extends Chart {
    initialize() {
        super.initialize();
        this.content.append("div")
            .attr("id", "sankey-warning")
            .classed("notification is-warning is-hidden", true);
    }

    orderSprints(sprints) {
        return sprints;
    }

    requestConfig() {
        return _.assign({}, super.requestConfig(), {
            expressions: true,
            details: true
        });
    }

    buildChartDimensions(content, axes={}, t=null) {
        const { newCharts, newProjects, newLegends } =
            super.buildChartDimensions(content, axes, t);

        newProjects.append("g").classed("nodes", true);
        newProjects.append("g").classed("links", true);
        return { newCharts, newProjects, newLegends };
    }

    format(data, state, resolve) {
        const noDetailsSelected =
            state.features.details.intersect(state.features.selected).isEmpty();
        this.content.select("#sankey-warning")
            .classed("is-hidden", !noDetailsSelected);
        this.content.selectAll("svg")
            .classed("is-invisible", noDetailsSelected);
        if (noDetailsSelected) {
            this.content.select("#sankey-warning")
                .text(this.locales.message("sankey-no-details-selected"));
            resolve();
            return;
        }

        const { projects, newProjects, newCharts } =
            this.createCharts(data, state);

        newCharts.classed("sankey", true);

        const updateProjects = newCharts.merge(projects).order()
            .select("g");

        const t = d3.transition().duration(1000)
            .on("end", () => resolve());

        const { select } = this.updateFeatures(state, updateProjects);

        this.updateLegends(state, updateProjects, {
            t: t,
            sample: legend => legend.append("g"),
            hideLines: data => data.selected.size <= 1 &&
                !_.some(select, s => _.isArray(s)),
            color: sample => {
                const samples = sample.selectAll("rect")
                    .data((d, i) => {
                        const selectIndex = _.findIndex(select, s => s === d);
                        var idx = selectIndex + 1;
                        const stacks = [];
                        while (idx < select.length && _.isArray(select[idx])) {
                            stacks.push(select[idx][0]);
                            idx++;
                        }
                        return _.concat([{
                                feature: d,
                                index: selectIndex,
                                min: 0,
                                max: 1
                            }],
                            _.map(stacks, (s, j) => ({
                                feature: s,
                                index: selectIndex + j + 1,
                                min: j / stacks.length,
                                max: (j + 1) / stacks.length
                            }))
                        );
                    });
                samples.exit().remove();
                samples.enter()
                    .append("rect")
                    .attr("x", -16)
                    .attr("y", d => -d.max * 18)
                    .attr("width", 14)
                    .attr("height", d => (d.max - d.min) * 18)
                    .merge(samples).order()
                    .style("fill",
                        (d, i) => this.scheme[d.index % this.scheme.length]
                    );
            }
        });

        updateProjects.each(
            (d, i, nodes) => this.updateChart(state, d3.select(nodes[i]), d, i, t)
        );
        resolve();
    }

    updateFeatures(state, charts) {
        return {
            select: this.createStacks(state,
                Array.from(state.features.selected)
            )
        };
    }

    updateChart(state, chart, d, i, t) {
        const sprints = filterSprints(state, d.sprints);
        const data = sprintsToFeatures(sprints, state.features.visible,
            state.features.visible, {unwrap: true}
        );

        const width = this.width - this.legendWidths[i];
        var x = d3.scaleOrdinal()
            .range(linspace(0, width, sprints.length))
            .domain(_.range(sprints.length));

        this.updateAxes(chart, state, d, x, () => 0, {
            y: null
        });

        chart.select("g.features").selectAll("g.feature")
            .each((f, j, features) => {});

        const diagram = sankey()
            .nodeId(d => d.key)
            .nodeAlign((node, n) => n < sprints.length ? node.depth :
                (node.sprint_id / (sprints.length - 1)) * (n - 1)
            )
            .nodeWidth(15)
            .nodePadding(10)
            .extent([[1, 1], [width - 1, this.height - 5]]);

        const extra = Array.from(state.features.details
            .intersect(state.features.selected)
            .subtract(state.features.default));

        axios.all(_.map(Array.from(extra),
            f => axios.get(`data/${d.project_name}/details.${f}.json`)
        )).then(detailsRequests => {
            const details = _.assign({},
                _.pick(d.details, Array.from(state.features.selected)),
                _.fromPairs(_.map(detailsRequests,
                    (detailsData, i) => [extra[i], _.pick(detailsData.data,
                        _.map(sprints, s => _.isArray(s.sprint_id) ?
                            s.sprint_id[0] : s.sprint_id
                        )
                    )]
                ))
            );
            this.updateSankey(chart, diagram, sprints, data, details, state, t);
        });
    }

    updateSankey(chart, diagram, sprints, data, details, state, t) {
        const height = this.height;
        const updateLinkPath = (link) => link.attr("d", sankeyLinkHorizontal())
            .attr("clip-path", d => d.invisible ? null : `inset(
                ${Math.min(d.target.y0, d.source.y0)}
                ${this.svgWidth + this.textHeight - d.target.x0}
                ${height - Math.max(d.target.y1, d.source.y1)}
                ${d.source.x1}
            ) view-box`);

        const { nodes, links } = this.convertSankey(diagram, sprints, data,
            details, state
        );

        const updateNodes = chart.select("g.nodes")
            .attr("stroke", "#000")
            .selectAll("g")
            .data(nodes, d => d.key);

        updateNodes.exit().remove();
        const padding = diagram.nodePadding();
        const newNodes = updateNodes.enter()
            .append("g")
            .call(d3.drag().on("start", function(node) {
                node.yOrig = node.y0;
                this.parentNode.appendChild(this);
            }).on("drag", function(node) {
                const previous = node.y0;
                node.y0 = Math.max(0, Math.min(height - (node.y1 - node.y0),
                    node.y0 + d3.event.dy
                ));
                node.y1 += node.y0 - previous;
                d3.select(this)
                    .attr("transform", `translate(${node.x0}, ${node.y0})`);
                chart.select("g.nodes")
                    .selectAll("g")
                    .filter(d => d !== node && d.x0 == node.x0 &&
                        !d.invisible && (
                            (d.y0 >= node.y0 && d.y0 <= node.y1) ||
                            (d.y1 >= node.y0 && d.y1 <= node.y1)
                        ) &&
                        Math.abs(node.y0 - node.yOrig) > (d.y1 - d.y0) + padding
                    )
                    .each((d, i, nodes) => {
                        node.yOrig = d3.event.dy > 0 ? d.y1 - padding : d.y0 + padding;
                        const offset = d3.event.dy > 0 ?
                            node.y0 - (d.y1 - d.y0) - padding :
                            node.y0 + (node.y1 - node.y0) + padding;
                        d.y1 = offset + (d.y1 - d.y0);
                        d.y0 = offset;
                        d3.select(nodes[i])
                            .attr("transform", `translate(${d.x0}, ${d.y0})`);
                    });
                diagram.update({
                    nodes: chart.select("g.nodes").selectAll("g").data(),
                    links: chart.select("g.links").selectAll("g").data()
                });
                chart.select("g.links")
                    .selectAll("g path")
                    .call(updateLinkPath);
            }));

        newNodes
            .attr("transform", d => _.isNaN(d.y1) ? "translate(0, 0)" :
                `translate(${d.x0}, ${height - (d.y1 - d.y0)})`
            )
            .merge(updateNodes)
            .transition(t)
            .attr("transform", d => `translate(${d.x0}, ${d.y0})`);

        newNodes.append("title").each((d, i, nodes) => {
            const node = d3.select(nodes[i]);
            node.append("text").text(`${this.formatSprint(
                sprints[d.sprint_id], node, state.sprint_meta, "main"
            )}\n${this.locales.retrieve(this.localization.descriptions,
                d.feature_key
            )}\n`);
            this.formatFeature(d.feature_key, d.value, node.append("text"),
                true
            );
        });

        newNodes.append("rect")
            .attr("height", 0)
            .merge(updateNodes.select("rect"))
            .classed("is-invisible", d => !!d.invisible)
            .transition(t)
            .attr("fill", d => this.scheme[d.visible_index % this.scheme.length])
            .attr("width", d => _.isNaN(d.x1) ? diagram.nodeWidth() :
                d.x1 - d.x0
            )
            .attr("height", d => _.isNaN(d.y1) ? 0 : d.y1 - d.y0);

        const updateLinks = chart.select("g.links")
            .attr("fill", "none")
            .selectAll("g")
            .data(links, d => `${d.source.key}-${d.target.key}`);

        updateLinks.exit().remove();
        const newLinks = updateLinks.enter()
            .append("g")
            .style("mix-blend-mode", "multiply");

        newLinks.append("title")
            .classed("title", true)
            .each((d, i, nodes) => {
                const node = d3.select(nodes[i]);
                node.append("text").text(`${this.formatSprint(
                    sprints[d.source.sprint_id],
                    node, state.sprint_meta, "main"
                )} \u21d2 ${this.formatSprint(sprints[d.target.sprint_id],
                    node, state.sprint_meta, "main"
                )}\n${this.locales.retrieve(this.localization.descriptions,
                    d.source.feature_key
                )} \u21d2 ${this.locales.retrieve(this.localization.descriptions,
                    d.target.feature_key
                )}\n`);
                this.formatFeature(d.source.feature_key, d.value,
                    node.append("text"), true
                );
            });

        newLinks.append("path")
            .merge(updateLinks.select("path"))
            .classed("is-invisible", d => !!d.invisible)
            .transition(t)
            .attr("stroke", d => this.scheme[d.source.visible_index % this.scheme.length])
            .attr("stroke-width", d => Math.max(1, d.width))
            .call(updateLinkPath);
    }

    convertSankey(diagram, sprints, data, details, state) {
        const nodes = _.concat(
            _.map(sprints, (s, i) => ({
                key: `${i}-_extra`,
                sprint_id: i,
                invisible: true,
                feature_key: '',
                visible_index: 0,
            })),
            _.flattenDeep(_.map(data, f => _.map(f.sprints, (s, i) => {
                const sprint = this.getSprintDetails(details[f.feature_key],
                    sprints[i].sprint_id
                );
                return sprint && sprint.key ? _.assign({}, {
                    key: `${i}-${f.feature_key}`,
                    sprint_id: i,
                    value: s
                }, _.pick(f, ['feature_key', 'visible_index'])) : [];
            })))
        );

        const getPoints = (detail, i, value) => {
            if (detail.story_points) {
                return this.defined(detail.story_points[i]) ?
                    Number(detail.story_points[i]) : 0;
            }
            return value / detail.key.length;
        };
        const getLink = (sprint, keys, i, feature, otherFeature) => {
            const value = _.sum(_.map(sprint.key,
                (k, j) => keys.includes(k) ?
                    getPoints(sprint, j, sprints[i][feature]) : 0
            ));
            if (value === 0) {
                return null;
            }
            return {
                source: i > 0 ? `${i - 1}-${otherFeature}` : `${i}-${feature}`,
                target: i > 0 ? `${i}-${feature}` : `${i + 1}-${otherFeature}`,
                value: value
            };
        };

        const features = state.features.selected.intersect(state.features.details);
        const links = _.flattenDeep(_.map(sprints, (s, i) => {
            if (sprints.length === 1) {
                return [];
            }

            const otherSprintId = sprints[i === 0 ? i + 1 : i - 1].sprint_id;
            var earlierFeatures = OrderedSet();
            return _.map(Array.from(features), feature => {
                const detail = details[feature];
                const sprint = this.getSprintDetails(detail, s.sprint_id);
                if (!sprint || !sprint.key) {
                    return [];
                }
                const duplicates = Array.from(feature.startsWith('backlog_') ?
                    features.delete(feature) : earlierFeatures
                );
                var remainingKeys = _.reduce(duplicates,
                    (keys, concurrentFeature) => {
                        const sprint = this.getSprintDetails(
                            details[concurrentFeature], s.sprint_id
                        );
                        if (!sprint || !sprint.key) {
                            return keys;
                        }
                        return keys.subtract(sprint.key);
                    },
                    OrderedSet(sprint.key)
                );
                var link = _.map(details, (otherDetail, otherFeature) => {
                    const otherSprint = this.getSprintDetails(otherDetail,
                        otherSprintId
                    );
                    if (!otherSprint || !otherSprint.key) {
                        return [];
                    }
                    const keys = remainingKeys.intersect(otherSprint.key);
                    if (keys.size === 0) {
                        return [];
                    }
                    remainingKeys = remainingKeys.subtract(keys);
                    if (i > 0) {
                        return getLink(sprint, keys, i, feature,
                            otherFeature
                        ) || [];
                    }
                    return [];
                });
                if (!remainingKeys.isEmpty()) {
                    const extraLink = getLink(sprint, remainingKeys, i, feature,
                        "_extra"
                    );
                    if (extraLink !== null) {
                        link.push(_.assign({}, extraLink, {
                            invisible: true
                        }));
                    }
                }
                if (!feature.startsWith('backlog_')) {
                    earlierFeatures = earlierFeatures.add(feature);
                }
                return link;
            });
        }));
        return diagram({
            nodes: nodes,
            links: links
        });
    }
}
