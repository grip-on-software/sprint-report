
export default class Axis {
    constructor(chart, axis, config) {
        this.chart = chart;
        this.axis = axis;
        this.config = config;
    }

    update(t, locales, localization) {
        this.chart.select(`.axis.${this.axis}`)
            .transition(t)
            .attr("transform", this.config.transform)
            .call(this.config.axis !== null ? this.config.axis :
                node => node.selectAll('*')
                    .style("opacity", 0)
                    .remove()
            );

        const label = this.chart.select(`.label.${this.axis}`);
        const text = this.config.label.features &&
            this.config.label.features.size === 1 ?
            locales.retrieve(localization.descriptions,
                this.config.label.features.first()
            ) : this.config.label.text;

        if (text) {
            label.text(text);
        }
        label.transition(t)
            .style("opacity", text ? 1 : 0)
            .attr("x", this.config.label.x)
            .attr("y", this.config.label.y);
    }
}
