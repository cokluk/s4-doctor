fx_version 'cerulean'
game 'gta5'

name 's4-doctor'
description 'FiveM debug hub — log capture, agent execute bridge, optional doctor.lua inject'
author 's4-doctor'
version '2.1.0'

dependency 'yarn'

lua54 'yes'

shared_scripts {
    'shared/config.lua',
}

ui_page 'ui/index.html'

files {
    'doctor.lua',
    'ui/index.html',
    'ui/style.css',
    'ui/app.js',
}

server_scripts {
    'api/launcher.lua',
    'server/resourceManager.lua',
    'server.lua',
}

client_scripts {
    'client.lua',
}

provide 's4-doctor'
