pipeline {
    agent { label 'docker' }

    environment {
        IMAGE_TAG = env.BRANCH_NAME.replaceFirst('^master$', 'latest')
        GITLAB_TOKEN = credentials('sprint-report-gitlab-token')
        SCANNER_HOME = tool name: 'SonarQube Scanner 3', type: 'hudson.plugins.sonar.SonarRunnerInstallation'
    }

    options {
        gitLabConnection('gitlab')
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }
    triggers {
        gitlab(triggerOnPush: true, triggerOnMergeRequest: true, branchFilterType: 'All', secretToken: env.GITLAB_TOKEN)
        cron(env.VISUALIZATION_CRON)
    }

    post {
        failure {
            updateGitlabCommitStatus name: env.JOB_NAME, state: 'failed'
        }
        aborted {
            updateGitlabCommitStatus name: env.JOB_NAME, state: 'canceled'
        }
    }

    stages {
        stage('Start') {
            when {
                not {
                    triggeredBy 'TimerTrigger'
                }
            }
            steps {
                updateGitlabCommitStatus name: env.JOB_NAME, state: 'running'
            }
        }
        stage('Build') {
            steps {
                sh 'docker build -t $DOCKER_REGISTRY/gros-sprint-report:$IMAGE_TAG . --build-arg NPM_REGISTRY=$NPM_REGISTRY'
            }
        }
        stage('SonarQube Analysis') {
            when {
                not {
                    triggeredBy 'TimerTrigger'
                }
            }
            steps {
                withSonarQubeEnv('SonarQube') {
                    sh '${SCANNER_HOME}/bin/sonar-scanner -Dsonar.projectKey=sprint-report:$BRANCH_NAME -Dsonar.projectName="Sprint Report $BRANCH_NAME"'
                }
            }
        }
        stage('Push') {
            when { branch 'master' }
            steps {
                sh 'docker push $DOCKER_REGISTRY/gros-sprint-report:latest'
            }
        }
        stage('Collect') {
            agent {
                docker {
                    image "${env.DOCKER_REGISTRY}/gros-data-analysis-dashboard"
                    reuseNode true
                }
            }
            steps {
                withCredentials([file(credentialsId: 'data-analysis-config', variable: 'ANALYSIS_CONFIGURATION')]) {
                    sh '/bin/bash -c "rm -rf $PWD/output && mkdir $PWD/output && cd /home/docker && Rscript features.r $REPORT_PARAMS --recent --split --old --details --future 80 --project-metadata recent,core --combine start_date --teams --prediction \'\\${prediction_data}\' --log INFO --config $ANALYSIS_CONFIGURATION --output $PWD/output"'
                }
            }
        }
        stage('Visualize') {
            agent {
                docker {
                    image "${env.DOCKER_REGISTRY}/gros-sprint-report:${env.IMAGE_TAG}"
                    reuseNode true
                }
            }
            steps {
                withCredentials([file(credentialsId: 'sprint-report-config', variable: 'SPRINT_REPORT_CONFIGURATION')]) {
                    sh 'rm -rf public/data/'
                    sh 'mkdir -p public/'
                    sh 'mv output/recent_sprint_features/ public/data/'
                    sh 'rm -rf node_modules/'
                    sh 'ln -s /usr/src/app/node_modules .'
                    sh 'MIX_FILE=$WORKSPACE/webpack.mix.js npm run production'
                }
                publishHTML([allowMissing: true, alwaysLinkToLastBuild: false, keepAll: true, reportDir: 'public', reportFiles: 'index.html', reportName: 'Visualization', reportTitles: ''])
            }
        }
        stage('Status') {
            when {
                not {
                    triggeredBy 'TimerTrigger'
                }
            }
            steps {
                updateGitlabCommitStatus name: env.JOB_NAME, state: 'success'
            }
        }
    }
}
