import _ from 'lodash';
import * as d3 from 'd3';
import axios from 'axios';
import {sankey, sankeyLinkHorizontal} from 'd3-sankey';
import {OrderedSet} from 'immutable';
import {sprintsToFeatures} from '../data';
import {Chart, linspace} from './Chart';
import {STROKE_WIDTH_ATTR} from '../attrs';

export default class SankeyChart extends Chart {
    initialize() {
        super.initialize();
        this.content.append("div")
            .attr("id", "sankey-warning")
            .classed("notification is-warning is-hidden", true);
        this.scheme = _.concat(this.scheme, ['#ababab']);
    }

    orderSprints(sprints) {
        return sprints;
    }

    requestConfig() {
        return _.assign({}, super.requestConfig(), {
            details: true
        });
    }

    format(data, state, resolve) {
        const noDetailsSelected = !state.projects.selected.isEmpty() &&
            state.features.details.intersect(state.features.selected).isEmpty();
        this.content.select("#sankey-warning")
            .classed("is-hidden", !noDetailsSelected);
        this.content.selectAll("svg")
            .classed("is-invisible", noDetailsSelected);
        if (noDetailsSelected) {
            this.content.select("#sankey-warning")
                .text(this.locales.message("sankey-no-details-selected"));
            resolve(data);
            return;
        }

        const { projects, newProjects, newCharts } =
            this.createCharts(data, state);
        newProjects.append("g").classed("nodes", true);
        newProjects.append("g").classed("links", true);

        newCharts.classed("sankey", true);

        const updateProjects = newCharts.merge(projects).order()
            .select("g");

        const t = this.makeTransition(data, resolve);

        this.updateLegends(state, updateProjects, {
            t: t,
            sample: legend => legend.append("rect")
                .attr("x", -15)
                .attr("y", -18)
                .attr("width", 15)
                .attr("height", 18)
                .attr("stroke", "#000")
        });

        updateProjects.each(
            (d, i, nodes) => this.updateChart(state, d3.select(nodes[i]), d, i, t)
        );
        resolve(data);
    }

    updateChart(state, chart, d, i, t) {
        const data = sprintsToFeatures(d.sprints, state.features.visible,
            state.features.visible, {unwrap: true}
        );

        const width = this.width - this.legendWidths[i];
        var x = d3.scaleOrdinal()
            .range(linspace(0, width, d.sprints.length))
            .domain(_.range(d.sprints.length));

        this.updateAxes(chart, state, d, {x, y: () => 0}, {y: null});

        chart.select("g.features").selectAll("g.feature")
            .each((f, j, features) => {});

        const diagram = sankey()
            .nodeId(d => d.key)
            .nodeAlign(
                (node, n) => n < d.sprints.length || d.sprints.length <= 1 ?
                    node.depth :
                    (node.sprint_id / (d.sprints.length - 1)) * (n - 1)
            )
            .nodeWidth(15)
            .nodePadding(10)
            .nodeSort(d.sprints.length <= 1 ? null : (firstNode, secondNode) => {
                if (firstNode.index < secondNode.index) {
                    return -1;
                }
                if (firstNode.index > secondNode.index) {
                    return 1;
                }
                return 0;
            })
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
                        _.map(d.sprints, s => _.isArray(s.sprint_id) ?
                            s.sprint_id[0] : s.sprint_id
                        )
                    )]
                ))
            );
            this.updateSankey(chart, diagram, state, t, {
                sprints: d.sprints,
                features: data,
                details: details
            });
        });
    }

    updateSankey(chart, diagram, state, t, data) {
        const height = this.height;
        const updateLinkPath = (link) => link.attr("d", sankeyLinkHorizontal())
            .attr("clip-path", d => `inset(
                ${Math.min(d.target.y0, d.source.y0)}
                ${this.svgWidth + this.textHeight - d.target.x0}
                ${height - Math.max(d.target.y1, d.source.y1)}
                ${d.source.x1}
            ) view-box`);

        const padding = diagram.nodePadding();
        const within = (y, node) => y >= node.y0 && y <= node.y1;
        const nodeOverlaps = (d, node) => {
            if (d.x0 !== node.x0) {
                return false;
            }
            return (within(d.y0, node) || within(d.y1, node)) &&
                Math.abs(node.y0 - node.yOrig) > (d.y1 - d.y0) + padding;
        };

        const { nodes, links } = this.convertSankey(diagram, data, state);

        const updateNodes = chart.select("g.nodes")
            .attr("stroke", "#000")
            .selectAll("g")
            .data(nodes, d => d.key);

        updateNodes.exit().remove();
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
                    .filter(d => d !== node && d.x0 === node.x0 &&
                        nodeOverlaps(d, node)
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
            .attr("transform", d => _.isNaN(d.y0) ? "translate(0, 0)" :
                `translate(${d.x0}, ${d.y0})`
            );

        newNodes.append("title").each((d, i, nodes) => {
            const node = d3.select(nodes[i]);
            node.append("text").text(`${this.formatSprint(
                data.sprints[d.sprint_id], node, state.sprint_meta, "main"
            )}\n${this.locales.retrieve(this.localization.descriptions,
                d.feature_key
            )}\n`);
            this.formatFeature(d.feature_key, d.value, node.append("text"),
                {svg: true}
            );
        });

        newNodes.append("rect")
            .attr("height", 0)
            .merge(updateNodes.select("rect"))
            .attr("stroke-dasharray", d => d.partial ? 4 : null)
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
                    data.sprints[d.source.sprint_id],
                    node, state.sprint_meta, "main"
                )} \u21d2 ${this.formatSprint(data.sprints[d.target.sprint_id],
                    node, state.sprint_meta, "main"
                )}\n${this.locales.retrieve(this.localization.descriptions,
                    d.source.feature_key
                )} \u21d2 ${this.locales.retrieve(this.localization.descriptions,
                    d.target.feature_key
                )}\n`);
                this.formatFeature(d.source.feature_key, d.value,
                    node.append("text"), {svg: true}
                );
            });

        newLinks.append("path")
            .merge(updateLinks.select("path"))
            .transition(t)
            .attr("stroke", d => this.scheme[d.source.visible_index % this.scheme.length])
            .attr(STROKE_WIDTH_ATTR, d => d.width)
            .call(updateLinkPath);
    }

    getNodes(sprints, data, details) {
        return _.concat(
            _.map(sprints, (s, i) => ({
                key: `${i}-_extra`,
                sprint_id: i,
                partial: true,
                feature_key: '?',
                index: -1,
                visible_index: this.scheme.length - 1,
            })),
            _.flattenDeep(_.map(data, f => _.map(f.sprints, (s, i) => {
                const sprint = this.getSprintDetails(details[f.feature_key],
                    sprints[i].sprint_id
                );
                return sprint && sprint.key ? _.assign({}, {
                    key: `${i}-${f.feature_key}`,
                    sprint_id: i,
                    value: s,
                    index: f.visible_index
                }, _.pick(f, ['feature_key', 'visible_index'])) : [];
            })))
        );
    }

    getPoints(detail, i, value) {
        if (detail.story_points) {
            return this.defined(detail.story_points[i]) ?
                Number(detail.story_points[i]) : 0;
        }
        return value / detail.key.length;
    }

    getLink(sprints, sprint, keys, i, featurePair) {
        const [feature, otherFeature] = featurePair;
        if (keys.isEmpty()) {
            return [];
        }
        const value = _.sum(_.map(sprint.key,
            (k, j) => keys.includes(k) ?
                this.getPoints(sprint, j, sprints[i][feature]) : 0
        ));
        if (value === 0) {
            return [];
        }
        return [{
            source: i > 0 ? `${i - 1}-${otherFeature}` : `${i}-${feature}`,
            target: i > 0 ? `${i}-${feature}` : `${i + 1}-${otherFeature}`,
            value: value
        }];
    }

    getCandidateFeatures(features, earlierFeatures, feature) {
        return feature.startsWith('backlog_') ?
            features.delete(feature) :
            earlierFeatures.filter(f => !f.startsWith('backlog_'));
    }

    cleanDuplicates(details, candidates, keys, id) {
        return _.reduce(Array.from(candidates),
            (accumulator, concurrentFeature) => {
                const sprint = this.getSprintDetails(
                    details[concurrentFeature], id
                );
                if (!sprint.key) {
                    return accumulator;
                }
                return accumulator.subtract(sprint.key);
            },
            OrderedSet(keys)
        );
    }

    convertSankey(diagram, data, state) {
        const nodes = this.getNodes(data.sprints, data.features, data.details);

        const features = state.features.selected.intersect(state.features.details);
        const getLinks = (feature, earlierFeatures, s, i, otherSprintId) => {
            const detail = data.details[feature];
            const sprint = this.getSprintDetails(detail, s.sprint_id);
            if (!sprint.key) {
                return [];
            }
            var remainingKeys = this.cleanDuplicates(data.details,
                this.getCandidateFeatures(features, earlierFeatures, feature),
                sprint.key, s.sprint_id
            );
            var link = _.map(data.details, (otherDetail, otherFeature) => {
                const otherSprint = this.getSprintDetails(otherDetail,
                    otherSprintId
                );
                if (!otherSprint.key) {
                    return [];
                }
                const keys = remainingKeys.intersect(otherSprint.key);
                remainingKeys = remainingKeys.subtract(keys);
                if (i > 0) {
                    return this.getLink(data.sprints, sprint, keys, i,
                        [feature, otherFeature]
                    );
                }
                return [];
            });
            if (!remainingKeys.isEmpty()) {
                const extraLink = this.getLink(data.sprints, sprint,
                    remainingKeys, i, [feature, "_extra"]
                );
                link = link.concat(_.map(extraLink, l => _.assign({}, l, {
                    partial: true
                })));
            }
            return link;
        };

        const getSprintLinks = (s, i) => {
            const otherSprintId = data.sprints[i === 0 ? i + 1 : i - 1].sprint_id;
            var earlierFeatures = OrderedSet();
            return _.concat(_.map(Array.from(features), feature => {
                const link = getLinks(feature, earlierFeatures, s, i,
                    otherSprintId
                );
                earlierFeatures = earlierFeatures.add(feature);
                return link;
            }), i === 0 ? [] : {
                source: `${i - 1}-_extra`,
                target: `${i}-_extra`,
                value: 0
            });
        };

        const links = data.sprints.length === 1 ? [] :
            _.flattenDeep(_.map(data.sprints, (s, i) => getSprintLinks(s, i)));

        return diagram({
            nodes: nodes,
            links: links
        });
    }
}
