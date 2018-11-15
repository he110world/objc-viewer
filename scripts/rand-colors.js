const rand_color = require('randomcolor')
const count = Number(process.argv[2] || 100)
const color_list = []
for(let i=0; i<count; i++){
	const str = rand_color()
	const hex = str.replace('#','0x') //'0x'+Number(str.replace('#','0x')).toString(16)
	color_list.push(hex)
}

let out = '['
for(let i=0; i<color_list.length-1; i++){
	out += color_list[i]+','
}
out += color_list[color_list.length-1] + ']'
console.log(out)
