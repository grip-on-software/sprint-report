import _ from 'lodash';
import * as d3 from 'd3';
import {OrderedSet} from 'immutable';
import Chart from './Chart';

export default class ScatterPlot extends Chart {
    initialize() {
        super.initialize();
        const charts = this.content.selectAll('svg').data([0]);
        const { newCharts, newProjects } = this.buildChartDimensions(charts, {
            x2: true,
            y2: true,
            x0: true,
            y0: true
        });
        newCharts.classed("scatterplot", true);
        newProjects.append("g")
            .classed("features", true)
            .attr("stroke-width", 2.5)
            .attr("fill", "none");
        newProjects.append("g")
            .classed("clusters", true);
        const { focus, overlay } = this.createFocus(newProjects);
        this.focusCircle = focus.append("circle")
            .attr("r", 3)
            .style("fill", "black")
            .classed("is-hidden", true);

        overlay.remove();
        newProjects.append("g")
            .classed("brush", true)
            .datum([]);

        this.x = null;
        this.y = null;
        this.idleTimeout = null;
        this.brushing = false;
        this.zooming = false;
        this.groups = [];
        this.focus = null;
        this.brushDelay = 350;
    }

    createBrush(chart, state) {
        var brushTimer = null;
        const brush = d3.brush()
            .on("start", () => {
                this.brushing = true;
                brushTimer = setTimeout(() => {
                    if (this.brushing || this.zooming) {
                        chart.select(".focus")
                            .style("visibility", "hidden")
                            .datum([])
                            .classed("fixed", false);
                        this.focusCircle.classed("is-hidden", true);
                    }
                }, this.brushDelay);
            })
            .on("end", () => {
                this.brushing = false;
                clearTimeout(brushTimer);
                this.endBrush(brush, state);
            });
        chart.select(".brush").call(brush);
    }

    endBrush(brush, state) {
        if (this.x === null) {
            return;
        }

        const chart = this.content.select('svg');
        const sourceEvent = d3.event.sourceEvent;
        const selection = d3.event.selection;
        const x = this.x.scale;
        const y = this.y.scale;
        if (selection) {
            const clip = [Math.max, Math.min];
            x.domain(_.map([selection[0][0], selection[1][0]],
                (value, i) => clip[i](x.invert(value), this.x.domain[i])
            ));
            y.domain(_.map([selection[1][1], selection[0][1]],
                (value, i) => clip[i](y.invert(value), this.y.domain[i])
            ));
            chart.select('.brush').call(brush.move, null);
        }
        else {
            if (this.brushFocus(this.focus.pinTooltip)) {
                const focusHolder = chart.select("g.focus");
                if (!_.isEqual(focusHolder.datum(), [])) {
                    focusHolder.style("visibility", null);
                    this.focusCircle.classed("is-hidden", false);
                }
                return;
            }
            if (!this.idleTimeout) {
                this.idleTimeout = setTimeout(() => {
                    this.idleTimeout = null;
                }, this.brushDelay);
                return;
            }
            x.domain(this.x.domain);
            y.domain(this.y.domain);
        }
        this.zoom(state);
    }

    brushFocus(action) {
        if (this.focus !== null && d3.event !== null) {
            const element = d3.event.sourceEvent !== null &&
                d3.event.sourceEvent.target instanceof SVGElement ?
                d3.event.sourceEvent.target : document.documentElement;
            return action(element);
        }
        return false;
    }

    coordsInDomain(x, y) {
        const xDomain = this.x.scale.domain();
        const yDomain = this.y.scale.domain();
        return x >= xDomain[0] && x <= xDomain[1] &&
            y >= yDomain[0] && y <= yDomain[1];
    }

    pointInDomain(point) {
        return (!_.isEmpty(point) &&
            this.coordsInDomain(point[this.x.feature], point[this.y.feature])
        );
    }

    zoom(state, t=null) {
        this.zooming = true;
        const chart = this.content.select('svg');
        chart.select('g.focus')
            .style("visibility", "hidden")
            .datum([]);
        this.focusCircle.classed("is-hidden", true);
        this.brushFocus(this.focus.moveTooltip);
        if (t === null) {
            t = chart.transition().duration(750);
        }

        // Update axis and scale
        this.updateAxes(chart, state, chart.datum(), this.x.scale, this.y.scale, {
            t: t,
            x: this.x,
            y: this.y,
            x2: {
                axis: d3.axisBottom(this.x.scale)
                    .tickSize(this.y.range)
                    .tickFormat("")
            },
            y2: {
                axis: d3.axisLeft(this.y.scale)
                    .tickSize(this.x.range)
                    .tickFormat("")
            },
            x0: true,
            y0: true
        });

        const circles = chart.select("g.features")
            .selectAll("circle");
        circles.transition(t)
            .attr("cx", d => this.x.scale(d[this.x.feature]))
            .attr("cy", d => this.y.scale(d[this.y.feature]))
            .style("stroke-opacity", d => this.pointInDomain(d) ? 1 : 0)
            .on("end", () => {
                this.zooming = false;
            });
        const clusters = chart.select("g.clusters")
            .selectAll("g")
            .transition(t)
            .attr("opacity", d => this.coordsInDomain(d.x, d.y) ? 1 : 0)
            .on("end", () => {
                clusters.selection().interrupt();
                this.updateClusters(circles);
                const focusHolder = chart.select("g.focus");
                if (!_.isEqual(focusHolder.datum(), [])) {
                    focusHolder.style("visibility", null);
                    this.focusCircle.classed("is-hidden", false);
                }
            });
        clusters.selectAll("circle")
            .attr("cx", d => this.x.scale(d.x))
            .attr("cy", d => this.y.scale(d.y));
        clusters.selectAll("text")
            .attr("x", d => this.x.scale(d.x))
            .attr("y", d => this.y.scale(d.y));
    }

    updateClusters(circles) {
        const findCluster = (cluster, clusters) => {
            const other = _.find(clusters, c => {
                return cluster !== c &&
                    Math.abs(this.x.scale(cluster.x) - this.x.scale(c.x)) +
                    Math.abs(this.y.scale(cluster.y) - this.y.scale(c.y)) < 50;
            });
            if (typeof other !== "undefined") {
                const w1 = other.items.size;
                const w2 = cluster.items.size;
                other.x = (w1 * other.x + w2 * cluster.x) / (w1 + w2);
                other.y = (w1 * other.y + w2 * cluster.y) / (w1 + w2);
                other.items = cluster.items.union(other.items);
                return other;
            }
            return null;
        };

        this.groups = _.reduce(circles.nodes(), (accumulator, node) => {
            const datum = d3.select(node).datum();
            if (_.isEmpty(datum)) {
                return accumulator;
            }
            const group = circles.filter(d => {
                if (!this.pointInDomain(d)) {
                    return false;
                }
                const distance =
                    Math.abs(this.x.scale(datum[this.x.feature]) - this.x.scale(d[this.x.feature])) +
                    Math.abs(this.y.scale(datum[this.y.feature]) - this.y.scale(d[this.y.feature]));
                return distance < 25;
            });
            if (group.size() > 1) {
                const data = group.data();
                const cluster = {
                    items: OrderedSet(data),
                    x: _.meanBy(data, d => d[this.x.feature]),
                    y: _.meanBy(data, d => d[this.y.feature])
                };
                var other = findCluster(cluster, accumulator);
                if (other !== null) {
                    var newOther = findCluster(other, accumulator);
                    while (newOther !== null) {
                        accumulator.splice(accumulator.indexOf(other), 1);
                        other = newOther;
                        newOther = findCluster(other, accumulator);
                    }
                }
                else {
                    accumulator.push(cluster);
                }
            }
            return accumulator;
        }, []);

        const clusters = this.content.select('svg g.clusters')
            .selectAll("g")
            .data(this.groups, d => d.x + d.y);
        clusters.exit().remove();

        const scheme = d3.schemeSet2;
        const newCluster = clusters.enter().append("g")
            .attr("opacity", 1);
        newCluster.append("circle");
        newCluster.append("text");
        const cluster = clusters.merge(newCluster)
            .sort((a, b) => a.x + a.y - b.x + b.y);
        cluster.select("circle")
            .attr("r", d => `${15 + 25 * d.items.size / circles.size()}`)
            .style("fill", (d, i) => scheme[i % scheme.length])
            .attr("cx", d => this.x.scale(d.x))
            .attr("cy", d => this.y.scale(d.y));
        cluster.select("text")
            .style("font-size", d => `${1.5 + d.items.size / circles.size()}em`)
            .style("stroke-width", d => `${0.025 + 0.1 * d.items.size / circles.size()}em`)
            .attr("dominant-baseline", "middle")
            .attr("x", d => this.x.scale(d.x))
            .attr("y", d => this.y.scale(d.y))
            .text(d => d.items.size);
    }

    build(state, spinner) {
        const promise = super.build(state, spinner);
        d3.select(`svg#${spinner.config.id}`).classed('is-overlay', true);
        this.addResizeHandler(state, {
            x2: true,
            y2: true,
            x0: true,
            y0: true
        });
        return promise;
    }

    format(data, state, resolve) {
        const chart = this.content.select('svg');
        this.createBrush(chart.select('g'), state);
        chart.datum(data);

        // Alter legend with projects
        this.updateLegends(state, chart, {
            data: state.projects,
            text: d => d,
            header: false,
            sample: legend => legend.append("circle")
                .attr("r", 4)
                .attr("cx", -5)
                .attr("cy", -6),
            sampleWidth: 8
        });

        const t = d3.transition().duration(750)
            .on("end", () => {
                this.zooming = false;
                resolve();
            });
        this.updateChart(state, chart, data, 0, t);
    }

    createFeatures() {
    }

    updateChart(state, chart, d, i, t) {
        // Select features
        const features = Array.from(state.features.selected.slice(0, 2));
        const points = features.length < 2 ? [] : _.flatten(_.map(d,
            (project, i) => {
                if (!state.projects.visible.includes(project.project_name)) {
                    return [];
                }
                const project_data = {
                    project: i,
                    project_name: project.project_name,
                    display_name: project.display_name || project.project_name
                };
                return _.map(project.sprints,
                    sprint => _.assign({},
                        _.mapValues(_.pick(sprint, _.concat(
                            Array.from(state.features.selected),
                            Array.from(state.sprint_meta.selected),
                            ["sprint_id", "board_id"]
                        )), value => _.isObject(value) && !_.isArray(value) ?
                            value.max : value
                        ),
                        project_data
                    )
                );
            }
        ));

        // Update points
        const circles = chart.select("g.features").selectAll("circle")
            .data(points, d => `${d.project_name}.${d.sprint_id}`);

        const xDomain = d3.extent(_.map(points, features[0]));
        const yDomain = d3.extent(_.map(points, features[1]));

        const rangeEnd = this.width - this.legendWidths[0] - 10;
        var x = d3.scaleLinear()
            .rangeRound([0, rangeEnd])
            .domain(xDomain);

        var y = d3.scaleLinear()
            .rangeRound([this.height, 0])
            .domain(yDomain);

        this.x = {
            scale: x,
            domain: xDomain,
            axis: d3.axisBottom(x),
            range: rangeEnd,
            feature: features[0],
            label: features[0] ?
                this.locales.retrieve(this.localization.descriptions,
                    features[0]
                ) :
                this.locales.message("features-header")
        };

        this.y = {
            scale: y,
            domain: yDomain,
            axis: d3.axisLeft(y),
            range: this.height,
            feature: features[1],
            label: features[1] ?
                this.locales.retrieve(this.localization.descriptions,
                    features[1]
                ) :
                this.locales.message("features-header")
        };

        circles.exit().remove();
        circles.enter().append("circle")
            .attr("r", 5)
            .style("stroke-opacity", 1)
            .classed("is-hidden", d => isNaN(d[features[0]]) || isNaN(d[features[1]]))
            .attr("cx", d => x(d[features[0]]))
            .attr("cy", d => y(d[features[1]]))
            .merge(circles).order()
            .style("stroke", d => this.scheme[d.project % this.scheme.length])
            .call((nodes) => this.updateClusters(nodes));

        // Update Focus with callbacks for individual/multiple points
        this.focus = this.updateFocus(chart, d, state, points, x, y, {
            range: () => x,
            mouseIndex: pos => pos,
            select: (i, j) => {
                const initial = {
                    distance: Infinity,
                    i: undefined,
                    feature: undefined,
                    scale: y,
                    index: undefined
                };
                if (this.zooming || points.length === 0 ||
                    features.length < 2 || !this.coordsInDomain(i, j)
                ) {
                    return initial;
                }

                const iScaled = x(i);
                const jScaled = y(j);
                const minimalPoint = _.reduce(points,
                    (minimal, point, index) => {
                        if (!this.pointInDomain(point)) {
                            return minimal;
                        }
                        const distance =
                            Math.abs(x(point[features[0]]) - iScaled) +
                            Math.abs(y(point[features[1]]) - jScaled);
                        if (distance < minimal.distance) {
                            return {
                                distance: distance,
                                i: point[features[0]],
                                feature: point[features[1]],
                                scale: y,
                                index: index
                            };
                        }
                        return minimal;
                    }, initial
                );
                return minimalPoint;
            },
            focus: (focusHolder, i, pos) => {
                if (typeof i === "undefined" || this.zooming ||
                    points.length === 0 || features.length < 2
                ) {
                    this.focusCircle.classed("is-hidden", true);
                    return;
                }
                this.focusCircle.classed("is-hidden", false)
                    .attr("cx", x(i))
                    .attr("cy", pos);
            },
            filter: features => _.concat(["display_name"], features),
            highlight: d => d[0] === features[0] || d[0] === features[1],
            has_source: (d, i) => {
                return i <= 1 || state.features.selected.includes(d[0]);
            },
            link: (m, i) => {
                if (m[0] === "display_name") {
                    return {
                        source: this.getProjectUrl(state,
                            points[i].project_name
                        )
                    };
                }
                if (state.sprint_meta.selected.includes(m[0])) {
                    return {source: this.getSprintUrl(points[i])};
                }
                return d[points[i].project].links[m[0]] || {};
            },
            makeLink: (link, i) => this.makeSprintUrl(link, points[i]),
            options: (tooltip, i) => {
                const cluster = _.find(this.groups,
                    group => group.items.includes(points[i])
                );
                const items = cluster ? Array.from(cluster.items) : [points[i]];
                const index = _.findIndex(items, v => v === points[i]);
                return [
                    {
                        id: "previous",
                        icon: ["fas", "fa-chevron-left"],
                        click: () => {
                            const c = items[index <= 0 ? items.length - 1 : index - 1];
                            const newIndex = _.findIndex(points, p => p === c);
                            return {
                                index: newIndex,
                                i: c[features[0]],
                                feature: c[features[1]]
                            };
                        }
                    },
                    {
                        id: "cluster",
                        text: `${index + 1} / ${items.length}`
                    },
                    {
                        id: "next",
                        icon: ["fas", "fa-chevron-right"],
                        click: () => {
                            const c = items[(index + 1) % items.length];
                            const newIndex = _.findIndex(points, p => p === c);
                            return {
                                index: newIndex,
                                i: c[features[0]],
                                feature: c[features[1]]
                            };
                        }
                    },
                    {
                        id: "zoom",
                        icon: ["fas", "fa-search"],
                        click: () => {
                            const x = (this.x.domain[1] - this.x.domain[0]) / 4;
                            const y = (this.y.domain[1] - this.y.domain[0]) / 4;
                            const clip = [Math.max, Math.min];
                            this.x.scale.domain(_.map([-x / 2, x / 2],
                                (v, j) => clip[j](points[i][features[0]] + v,
                                    this.x.domain[j]
                                )
                            ));
                            this.y.scale.domain(_.map([-x / 2, x / 2],
                                (v, j) => clip[j](points[i][features[1]] + v,
                                    this.y.domain[j]
                                )
                            ));
                            this.zoom(state);
                        }
                    },
                    {
                        id: "remove",
                        icon: ["fas", "fa-trash-alt"],
                        click: () => {
                            const circles = chart.select("g.features")
                                .selectAll("circle");
                            circles.filter((d, j) => i === j)
                                .datum({})
                                .style("visibility", "hidden");
                            points[i] = {};
                            this.updateClusters(circles);
                            return false;
                        }
                    }
                ];
            }
        });

        this.zoom(state, t);
    }
}
