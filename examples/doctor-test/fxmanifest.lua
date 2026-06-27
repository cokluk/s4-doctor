fx_version 'cerulean'
game 'gta5'

name 'doctor-test'
description 'Example resource — s4-doctor integration test'
author 's4-doctor'
version '1.0.0'

lua54 'yes'

dependency 's4-doctor'

shared_script '@s4-doctor/doctor.lua'

client_scripts {
    'client.lua',
}

server_scripts {
    'server.lua',
}
