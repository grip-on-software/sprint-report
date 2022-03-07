# Sprint report

This visualization produces configurable reports of software development 
projects, teams and components using various output formats.

## Configuration

Copy the file `lib/config.json` to `config.json` and adjust environmental 
settings in that file. The following configuration items are known:

- `visualization_url`: The URL to the visualization hub. This may include 
  a protocol and domain name, but does not need to in case all the 
  visualizations and the sprint report are hosted on the same domain (for 
  example in a development environment). The remainder is a path to the root of 
  the visualizations, where the dashboard is found and every other 
  visualization has sub-paths below it.
- `render_url`: The URL to a PDF render service that is used for the PDF export 
  option. If available, this URL must be a printf format string with two `%s` 
  format specifiers, where the first `%s` is to be replaced by a URL to the 
  report being shown, and the second `%s` is to be replaced by a message that 
  is displayed as the title of the report under that URL within print displays, 
  which may be used by the render service to wait until the page is properly 
  loader before making a snapshot. If this URL is an empty string, then the PDF 
  export is disabled.
- `jira_url`: The URL pointing to a Jira instance in order to link to projects 
  (or teams or components), sprints and issues. If this is set to an empty 
  string, then these elements are not linked or even not added to the report.
- `access_url`: The URL pointing to a JSON endpoint that indicates which 
  projects, teams and components should be displayed most prominently to the 
  user for selection. If available, the JSON in the reponse must be an array of 
  project identifiers (keys or names) as strings. If the array is empty or 
  contains a string `"*"`, then project selection does not perform further 
  filtering, otherwise the selector will display the indicated projects and 
  potentially display them in the report if the URL hash indicates to do so 
  (`~accessible` is part of the `#project_` part of the hash). If this URL is 
  an empty string, then project selection does not perform further filtering.
- `path`: The relative path at which the sprint report is made available on the 
  server. This can remain the default `.` to work just fine.

## Data

The data for the sprint report can be analyzed and output through runs of 
scripts from the `data-analysis` repository upon a collection of Scrum data in 
a Grip on Software database. The `features.r` script in that repository has 
options to export the sprint data in the JSON formats that is expected by the 
sprint report (for an example, see the `Collect` step in the `Jenkinsfile`). 
The entire data collection must be placed in the `public/data` directory.

## Running

The visualization can be built using Node.js and `npm` by running `npm install` 
and then either `npm run watch` to start a development server that also 
refreshes browsers upon code changes, or `npm run production` to create 
a minimized bundle. The resulting HTML, CSS and JavaScript is made available in 
the `public` directory.

This repository also contains a `Dockerfile` specification for a Docker image 
that can performs the installation of the app and dependencies, which allows 
building the visualization within there. The `Jenkinsfile` contains appropriate 
steps for a Jenkins CI deployment, including data collection and visualization 
building.
