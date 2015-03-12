# Piper

Piper is an AI personal assistant that automates the fulfilment of tasks on back end enterprise systems, for example: piper can help you make the booking and approval of your next travel request an interactive, painless excercise.

### Contributing to Piper Development
**The Piper Development Workflow:**

Download and Install the following:
	
- [Node.js](http://nodejs.org/download/) 
- [Meteor.js](https://www.meteor.com/install)
- [Mongo DB](https://www.mongodb.org/downloads)
- [Git](http://git-scm.com/downloads)

Clone the Piper Repository 

    $cd <your local development directory>
    $git clone https://github.com/c2gconsulting/piper.git

Create a branch for the task you want to work on

    $git checkout -b <my-branch>

Make changes to your work, **test locally**. Once you are comfortable with your work, `add`, `commit` and `push` to github.

    $git add .
    $git commit -m '<brief title for changes made>'
    $git fetch
    $git merge origin/<my-branch>
    $git push -u origin <my-branch>

Create a [Pull-Request](https://help.github.com/articles/using-pull-requests/) so that the repository manager(s) can review your code

Once the repository manager(s) review and approve your code, it will be merged to the master branch. 

Note that any committed changes to the master branch (including the merging of your branch to the master branch) will trigger an automatic deployment of the code to the running production instance. This is consistent with the principle of [continous deployment](http://guide.agilealliance.org/guide/cd.html)

For further information on this development workflow approach see: 
- [Understanding GitHub](https://www.youtube.com/watch?feature=player_detailpage&v=ZDR433b0HJY#t=2791s)
- [Understanding the GitHub Flow](https://guides.github.com/introduction/flow/index.html)