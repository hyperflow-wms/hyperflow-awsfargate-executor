# AWS Fargate executor for Hyperflow

https://github.com/hyperflow-wms/hyperflow

## Dockerizing application
Requirements: git, nodejs, docker

git clone https://github.com/burkat/hyperflow-awsfargate-executor.git

cd hyperflow-awsfargate-executor

npm install

docker build -t handler .

## Deploying docker image on AWS Fargate
Requirements: AWS CLI

Create ECR repository for docker image:
aws ecr create-repository --repository-name handler

If everything is ok you'll get something like this:
 "repository": {
        "repositoryArn": "arn:aws:ecr:eu-west-1:123456789:repository/handler",
        "registryId": "123456789",
        "repositoryName": "fargate-news-aggregator",
        "repositoryUri": "123456789.dkr.ecr.eu-west-1.amazonaws.com/handler",
        "createdAt": 1551957524.0
}

Now you need to push docker image onto ECR repository. Log in to the AWS website and navigate to the Repositories tab under the Elastic Container Service. You should able to see the repository you just created. Next, click on the repository and click on View Push Commands to get a list of commands that you need to run to be able to push your image to ECR. Follow the steps as they are given.

Example steps:

aws ecr get-login --no-include-email --region eu-west-1

sudo docker login -u AWS -p <long string from command above> https://123456789.dkr.ecr.eu-west-1.amazonaws.com
  
sudo docker tag handler:latest 123456789.dkr.ecr.eu-west-1.amazonaws.com/handler:latest

sudo docker push 123456789.dkr.ecr.eu-west-1.amazonaws.com/handler:latest

## Create Fargate application
First, go to think link https://eu-west-1.console.aws.amazon.com/ecs/home?region=eu-west-1#/getStarted to get started with creating a new Fargate Application.

Click get started, then select custom container and configure it. Give it some name, image URI can be found in ECR repository, for example:

123456789.dkr.ecr.eu-west-1.amazonaws.com/handler-repo:latest

Add port mapping for 8080 tcp then click update.

Click edit on Task definition - set some task definition name, and create proper task execution role which enables using S3. 2GB / 1 vCPU is recommended for Task memory and CPU. Click save and next.

Again next (we don't define load balancer here).

Set cluter name and next and create. 

On the next page, you should be able to see the status of the service you just created. Wait for the steps to complete and then click on View Service. 

## Running hyperflow with AWS Fargate
Once on the services page, click on the Tasks tab to see the different tasks running for your application. Click on the task id. In the Task Details page, you should be able to see the Public IP under the network section. Copy this IP address.

Update your workflow so it uses RESTServiceCommand function. 

In RESTServiceCommand.config.js set SERVICE_URL to copied IP address plus 8080 port, for example:
http://63.32.93.119:8080

Also remember to set storage (S3) and bucket & prefix. It is mandatory for this executor.

Then you can ran a workflow:
./hyperflow/bin/hflow run workflow.json

For more details check hyperflow page: https://github.com/hyperflow-wms/hyperflow. 
