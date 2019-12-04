# AWS Fargate executor for Hyperflow

## Dockerizing application
Requirements: git, nodejs, docker

git clone https://github.com/hyperflow-wms/hyperflow-awsfargate-executor.git

cd hyperflow-awsfargate-executor

npm install

copy selected dockerfile from handler_dockerfiles folder (default is enough in most cases)

docker build -t handler .

## Deploying docker image on AWS Fargate
Requirements: AWS CLI

Create ECR repository for docker image:
aws ecr create-repository --repository-name handler

Now you need to push docker image onto ECR repository. Log in to the AWS website and navigate to the Repositories tab under the Elastic Container Service. You should able to see the repository you have just created. Next, click on the repository and click on View Push Commands to get a list of commands that you need to run to be able to push your image to ECR. Follow the steps as they are given.

Example steps:

aws ecr get-login --no-include-email --region eu-west-1

sudo docker login -u AWS -p <string> https://123456789.dkr.ecr.eu-west-1.amazonaws.com
  
sudo docker tag handler:latest 123456789.dkr.ecr.eu-west-1.amazonaws.com/handler:latest

sudo docker push 123456789.dkr.ecr.eu-west-1.amazonaws.com/handler:latest

## Create Fargate application
First, go to this link https://eu-west-1.console.aws.amazon.com/ecs/home?region=eu-west-1#/getStarted to get started with creating a new Fargate Application.

Click get started, then select custom container and configure it. Give it some name, image URI can be found in ECR repository, for example:

123456789.dkr.ecr.eu-west-1.amazonaws.com/handler:latest

Click edit on Task definition - set some task definition name, and create proper task execution role which enables using S3. Click save and next.

Again next (we don't define load balancer).

Set cluster name and next and create. 

On the next page, you should be able to see the status of the service you have just created. Wait for the steps to complete and then click on View Service. 

## Running Hyperflow with AWS Fargate
Update your workflow so it uses awsFargateCommand function. 
Remember to update config file.

For more details check hyperflow page: https://github.com/hyperflow-wms/hyperflow. 
