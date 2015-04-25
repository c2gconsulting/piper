# mongo config template generation
node[:deploy].each do |appname, deployconfig|
  # determine root folder of new app deployment
  approot = "#{deployconfig[:deploy_to]}/current"

  # use template .mongo.json.erb. to generate 'config/mongo.json'
  template "#{approot}/shared/config/mongo.json" do
    source "./templates/mongo.json.erb"
    # cookbook "ppmongodb"

    # set mode, group and owner of generated file
    mode 00660
    group deployconfig[:group]
    owner deployconfig[:user]

    # only generate if its a valid nodejs app
    only_if do
       deployconfig[:application_type] == 'nodejs'
    end

  end
end