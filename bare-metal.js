const ArrayTypeNames = [
	null,
	'Float32Array',
	'Int8Array',
	'Int16Array',
	'Int32Array',
	'Uint8Array',
	'Uint16Array',
	'Uint32Array'
]

const ArrayTypes = [
	null,
	Float32Array,
	Int8Array,
	Int16Array,
	Int32Array,
	Uint8Array,
	Uint16Array,
	Uint32Array
]

function get_array_type(obj){
	return ArrayTypeNames.indexOf(obj.constructor.name)
}

function encode_r(obj,ta_list,ta_obj,key_stack,ctx){
	key_stack = key_stack || []
	for(let key in obj){
		const child_obj = obj[key]
		if(typeof child_obj === 'object'){
			const type = get_array_type(child_obj)
			if (type>0) {
				let to = ta_obj
				for(let i=0; i<key_stack.length; i++){
					const k = key_stack[i]
					to[k] = to[k] || {}
					to = to[k]
				}
				to[key] = 1

				ta_list.push({
					type:type,
					array:child_obj,
					obj:obj,
					key:key,
					offset:ctx.offset
				})

				ctx.offset = padding4(ctx.offset + child_obj.byteLength)

			} else {
				key_stack.push(key)
				encode_r(child_obj,ta_list,ta_obj,key_stack,ctx)
				key_stack.pop()
			}

		}
	}
}

function padding4(n){
	return Math.ceil(n/4)*4
}

function has_magic(array){
	const magic = 'BARE'
	for(let i=0; i<magic.length; i++){
		if (array[i] !== magic.charCodeAt(i)) {
			return false
		}
	}
	return true
}

function read_int(array,pos){
	return (array[pos]<<24)+(array[pos+1]<<16)+(array[pos+2]<<8)+array[pos+3]
}

//BareMetal类
function BareMetal (){
}

BareMetal.prototype.encode = function(input_obj){
	const ta_list = []
	const ta_obj = {}
	encode_r(input_obj,ta_list,ta_obj,[],{offset:8})

	let ta_len = 0
	if (ta_list.length>0) {
		for(let i=0; i<ta_list.length; i++){
			const ta = ta_list[i]

			//改写成[type,offset,count]
			//JSON必须放在文件最后，否则
			//JSON长度不确定<->offset不确定
			ta.obj[ta.key] = [ta.type,ta.offset,ta.array.length]

			ta_len += padding4(ta.array.byteLength)
		}
		input_obj.__keys = ta_obj
	}

	const json_str = JSON.stringify(input_obj)
	const json_len = json_str.length

	//header: ['BARE',json_offset]
	const header_len = 8
	const total_len = header_len + ta_len + json_len

	const buffer = new ArrayBuffer(total_len)
	const array = new Uint8Array(buffer)
	const view = new DataView(buffer)

	let pos = 0

	//写header
	//magic: 4字节
	const magic = 'BARE'
	for(let i=0; i<magic.length; i++){
		const c = magic.charCodeAt(i)
		view.setUint8(pos++,c)
	}
	//json在哪里：4字节
	view.setUint32(pos,header_len+ta_len)
	pos+=4

	//写数组
	if (ta_list.length>0) {
		for(let i=0; i<ta_list.length; i++){
			const ta = ta_list[i]
			const write_array = new ta.array.constructor(buffer, pos, ta.array.length)
			write_array.set(ta.array)
			pos = padding4(pos + ta.array.byteLength)
		}
	}

	//写JSON
	for(let i=0; i<json_str.length; i++){
		array[pos++] = json_str.charCodeAt(i)
	}
	pos = padding4(pos)

	return buffer
}

//DataView可能会很慢（V8 v6.9之前），所以解码不用它
BareMetal.prototype.decode = function(array_buffer){
	const array = new Uint8Array(array_buffer)
	let pos = 0

	//magic
	if (!has_magic(array)) {
		throw new Error('BareMetal: invalid format')
	}
	pos += 4

	//json 偏移量
	const json_offset = read_int(array,pos)
	pos += 4

	//读json
	//console.time(1.1)
	const json_str = String.fromCharCode.apply(null,array.subarray(json_offset))
	//console.timeEnd(1.1)

	//console.time(1.2)
	const json = JSON.parse(json_str)
	//console.timeEnd(1.2)

	//解析json->解析typed array
	//非递归DFS
	//console.time(1.3)
	if (json.__keys) {
		const key_stack = [json.__keys]
		const obj_stack = [json]
		do{
			const node = key_stack.pop()
			const obj = obj_stack.pop()
			for(let key in node){
				if (node[key]===1) {
					const ta = obj[key] //[type,offset,count]
					const type = ArrayTypes[ta[0]]
					obj[key] = new type(array_buffer, ta[1], ta[2])
				} else {
					key_stack.push(node[key])
					obj_stack.push(obj[key])
				}
			}
		}while(key_stack.length>0)

		delete json.__keys
	}
	//console.timeEnd(1.3)

	return json
}

//浏览器和node.js都能用
if (typeof global !== 'undefined') {
	module.exports = BareMetal
}
