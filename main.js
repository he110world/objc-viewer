const bm_loader = new BareMetal()
let dropArea = document.getElementById("drop-area")

// Prevent default drag behaviors
;['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
	dropArea.addEventListener(eventName, preventDefaults, false)   
	//document.body.addEventListener(eventName, preventDefaults, false)
})

// Highlight drop area when item is dragged over it
;['dragenter', 'dragover'].forEach(eventName => {
	dropArea.addEventListener(eventName, highlight, false)
})

;['dragleave', 'drop'].forEach(eventName => {
	dropArea.addEventListener(eventName, unhighlight, false)
})

// Handle dropped files
dropArea.addEventListener('drop', handleDrop, false)

function preventDefaults (e) {
	e.preventDefault()
	e.stopPropagation()
}

function highlight(e) {
	dropArea.classList.add('highlight')
}

function unhighlight(e) {
	dropArea.classList.remove('active')
}

const debug_opts = {
	landuse:{
		offset:-4
	},
	highway:{
		offset:-8
	}
}

function traverse_file_tree(item, cb) {
	if (item.isFile) {
		if (typeof cb==='function') {
			item.file(cb)
		}
	} else if (item.isDirectory) {
		var dir_reader = item.createReader()
		dir_reader.readEntries(function(entries) {
			//让图片排在模型前面
			entries.sort((a,b)=>get_file_type(b)-get_file_type(a))

			for (let i=0; i<entries.length; i++) {
				traverse_file_tree(entries[i], cb)
			}
		})
	}
}

const FileType = {
	UNKNOWN:0,

	DIRECTORY:1,

	OBJC:2,
	OBJC_GZ:3,
	FBX:4,
	PRWM:5,
	MD2:6,
	BARE_METAL:7,

	MTL:10,

	PNG:20,
	JPG:21,
}

function get_file_type(file){
	const name = file.name.toLowerCase()
	if (name.indexOf('.')===-1) {
		return FileType.DIRECTORY
	}
	if (name.endsWith('.objc.gz')) {
		return FileType.OBJC_GZ
	}

	let type = FileType.UNKNOWN
	const postfix = name.slice(name.lastIndexOf('.'))
	switch(postfix){
		case '.objc':
			type = FileType.OBJC
			break
		case '.fbx':
			type = FileType.FBX
			break
		case '.prwm':
			type = FileType.PRWM
			break
		case '.md2':
			type = FileType.MD2
			break
		case '.bm':
			type = FileType.BARE_METAL
			break
		case '.png':
			type = FileType.PNG
			break
		case '.jpg':
		case '.jpeg':
			type = FileType.JPG
			break
	}
	return type
}

let need_rescale = false
function read_file(file){
	const file_type = get_file_type(file)
	if (!file_type) {
		return
	}

	const reader = new FileReader()
	reader.onload = function(evt){
		try{
			const buf = evt.target.result
			if (file_type===FileType.OBJC || file_type===FileType.OBJC_GZ) {
				let str
				if (file_type===FileType.OBJC_GZ) {
					str = pako.inflate(buf,{to:'string'})
				} else {
					if (!decoder) {
						decoder = new TextDecoder('utf-8')
					}
					str = decoder.decode(buf)
				}
				console.time('objc')
				const obj = JSON.parse(str)
				current_obj = load_objc(obj,debug_opts)
				current_obj.name = file.name
				console.timeEnd('objc')
			} else if (file_type===FileType.FBX) {
				if (!fbx_loader) {
					fbx_loader = new THREE.FBXLoader()
				}
				const obj = fbx_loader.parse(buf)
				scene.add(obj)

				//因为要rescale，所以先隐藏起来，缩放完了再显示
				obj.visible = false
				current_obj = obj
				current_obj.name = file.name

				need_rescale = true
			} else if (file_type===FileType.PRWM) {
				console.time('prwm')

				const obj = load_prwm(buf)
				scene.add(obj)

				console.timeEnd('prwm')
			} else if (file_type===FileType.BARE_METAL) {
				console.time('bm')

				const obj = load_bm(buf)
				scene.add(obj)

				console.timeEnd('bm')
			} else if (file_type===FileType.MD2) {
				console.time('md2')

				load_md2(buf)
				need_rescale = true

				console.timeEnd('md2')
			} else if (file_type===FileType.PNG) {
				window.image_dict[file.name] = window.URL.createObjectURL( new Blob( [buf], { type: 'image/png'} ) )
			} else if (file_type===FileType.JPG) {
				window.image_dict[file.name] = window.URL.createObjectURL( new Blob( [buf], { type: 'image/jpeg'} ) )
			}
		}catch(e){
			alert('something wrong!')
			console.log(e)
		}
	}
	reader.readAsArrayBuffer(file)
}

function load_md2(buf){
	const model = new MD2Model()
	model.OnLoad = function(){
		const geometry = new THREE.BufferGeometry()
		const material = new THREE.MeshBasicMaterial({morphTargets:true})

		geometry.morphAttributes.position = []

		const indices = []
		for(let i=0; i<this.header.numberOfTriangles; i++){
			indices.push(this.triangles[i].verticumIndices[2], this.triangles[i].verticumIndices[1], this.triangles[i].verticumIndices[0])
		}

		for(let i=0; i<this.header.numberOfFrames; i++){
			const pos_array = []
			const f = this.frames[i]
			for(let j=0; j<this.header.numberOfVertices; j++){
				const x = f.vertices[j].position[1] * f.scale[1] + f.translation[1]
				const y = f.vertices[j].position[2] * f.scale[2] + f.translation[2]
				const z = f.vertices[j].position[0] * f.scale[0] + f.translation[0]
				pos_array.push(x,y,z)
			}
			const attr  = new THREE.Float32BufferAttribute(pos_array,3)
			attr.name = f.name
			geometry.morphAttributes.position[i] = attr
			if (i===0) {
				geometry.addAttribute('position', attr)
			}
		}
		geometry.setIndex(new THREE.Uint16BufferAttribute(indices,1))

		const mesh = new MorphMesh(geometry, material)
		mesh.parseAnimations()
		mesh.playAnimation(mesh.geometry.firstAnimation,12)
		scene.add(mesh)

		//for rescale
		mesh.visible = false
		current_obj = mesh
	}
	model.Parse(buf)
}

function rescale_model(fuzzy_meters){
	const bb = new THREE.Box3()
	bb.expandByObject(current_obj)

	const bs = new THREE.Sphere()
	bb.getBoundingSphere(bs)

	const r = bs.radius
	const num_digit = fuzzy_meters.toString().length
	const min_meter = Math.pow(10,num_digit-1)
	const max_meter = Math.pow(10,num_digit)

	const unit_per_meter = 1/111
	const min_unit = unit_per_meter * min_meter
	const max_unit = unit_per_meter * max_meter
	let scale = 1
	if (r < min_unit) {
		do{
			scale *= 10
		}while(r*scale<min_unit)
	} else if (r > max_unit) {
		do{
			scale /= 10
		}while(r*scale>max_unit)
	}
	
	current_obj.scale.x *= scale
	current_obj.scale.y *= scale
	current_obj.scale.z *= scale

	current_obj.visible = true
}

let current_obj, decoder, fbx_loader
function handleDrop(e) {
	if (current_obj) {
		scene.remove(current_obj)
	}
	window.image_dict = {}
	need_rescale = false

	const item_list = []
	for(let i=0; i<e.dataTransfer.items.length; i++){
		const item = e.dataTransfer.items[i].webkitGetAsEntry()
		if (item) {
			item_list.push(item)
		}
	}

	//先加载图片
	item_list.sort((a,b)=>get_file_type(b)-get_file_type(a))

	item_list.forEach(function(item){
		traverse_file_tree(item, read_file)
	})

}

if (!Detector.webgl) {
	Detector.addGetWebGLMessage();
}

var container;
var camera, controls, scene, renderer;
var lighting, ambient, keyLight, fillLight, backLight;

init();
animate();

const color_palette = [0x65daf7,0xa8f43d,0x3c9302,0xabf94a,0x7ce299,0x28e251,0xcc91ea,0x6eea6e,0xed1295,0x71f263]

function get_color(idx) {
	idx %= color_palette.length
	const color = new THREE.Color()
	color.setHex(color_palette[idx])
	return color
}

function create_line(p1,p2,color){
	const m = new THREE.LineBasicMaterial({color:color})
	const g = new THREE.Geometry()
	g.vertices.push(p1, p2)
	const line = new THREE.Line(g,m)
	return line
}

function init_coord_gizmo(){
	const group = new THREE.Group()
	const origin = new THREE.Vector3(0,0,0)
	const line_x = create_line(origin, new THREE.Vector3(100,0,0), 'red')
	const line_y = create_line(origin, new THREE.Vector3(0,100,0), 'green')
	const line_z = create_line(origin, new THREE.Vector3(0,0,100), 'blue')
	group.add(line_x,line_y,line_z)
	scene.add(group)
}

function TextureColorPicker (image) {
	const canvas = document.createElement( 'canvas' );
	canvas.width = image.width;
	canvas.height = image.height;

	const context = canvas.getContext( '2d' );
	context.drawImage( image, 0, 0 );

	this.image_data = context.getImageData( 0, 0, image.width, image.height );
}

function round_decimal(n,d){
	const p = Math.pow(10,d)
	return Math.floor(n*p)/p
}

TextureColorPicker.prototype.pick = function(u,v){
	const w = this.image_data.width
	const h = this.image_data.height
	const x = Math.floor(u*w)
	const y = Math.floor((1-v)*h)
	const i = ( x + w * y ) * 4; 
	const data = this.image_data.data;
	const r = round_decimal(data[i]/255,4)
	const g = round_decimal(data[i+1]/255,4)
	const b = round_decimal(data[i+2]/255,4)
	const a = round_decimal(data[i+3]/255,4)
	return {r:r,g:g,b:b,a:a}
}

function mesh_to_objc(mesh, scale){
	scale = scale || 1
	const geom = {}
	const meta = {}

	//没有顶点色，有纹理，需要采样顶点色
	if (!mesh.geometry.attributes.color && mesh.material.map && mesh.material.map.image) {
		const tex = new TextureColorPicker(mesh.material.map.image)
		const position = []
		const color = []
		const uv = []
		let normal

		//把三角形完全拆开
		const positions = mesh.geometry.attributes.position.array
		let normals
	       	if (mesh.geometry.attributes.normal) {
			normals = mesh.geometry.attributes.normal.array
			normal = []
		}
		const uvs = mesh.geometry.attributes.uv.array
		if (mesh.geometry.index) {
			const indices = mesh.geometry.index.array
			for(let i=0; i<indices.length; i++){
				const idx = indices[i]*3
				const x = positions[idx]
				const y = positions[idx+1]
				const z = positions[idx+2]
				position.push(x,y,z)

				/*
				if (normals) {
					normal.push(normals[idx], normals[idx+1], normals[idx+2])
				}
			       */

				const idx_uv = indices[i]*2
				const u = uvs[idx_uv]
				const v = uvs[idx_uv+1]
				uv.push(u,v)
			}
		} else {
			for(let i=0; i<positions.length; i++){
				position.push(positions[i])
			}
			for(let i=0; i<uvs.length; i++){
				uv.push(uvs[i])
			}
			if (normals) {
				for(let i=0; i<normals.length; i++){
					normal.push(normals[i])
				}
			}
		}

		//旋转
		const k = scale * mesh.scale.x
		const v = new THREE.Vector3()
		for(let i=0; i<position.length; i+=3){
			const x = k * position[i]
			const y = k * position[i+1]
			const z = k * position[i+2]
			v.set(x,y,z)
			v.applyEuler(mesh.rotation)
			position[i] = round_decimal(v.x,7)
			position[i+1] = round_decimal(v.y,7)
			position[i+2] = round_decimal(v.z,7)
		}
		//旋转法线
		/*
		if(normal){
			for(let i=0; i<normal.length; i+=3){
				const x = normal[i]
				const y = normal[i+1]
				const z = normal[i+2]
				v.set(x,y,z)
				v.applyEuler(mesh.rotation)
				normal[i] = v.x
				normal[i+1] = v.y
				normal[i+2] = v.z
			}
		}
	       */

		for(let i=0; i<uv.length; i+=2){
			const u = uv[i]
			const v = uv[i+1]
			const c = tex.pick(u,v)
			color.push(c.r,c.g,c.b)
		}

		//合并颜色相同的顶点
		geom.position = {
			array:position,
			size:3,
			count:position.length/3
		}
		geom.color = {
			array:color,
			size:3,
			count:color.length/3
		}
		/*
		if(normal){
			geom.normal = {
				array:normal,
				size:3,
				count:normal.length/3
			}
		}
	       */
	} else {
		const color = []
		if (mesh.geometry.attributes.position) {
			const list = []
			const k = scale * mesh.scale.x
			const v = new THREE.Vector3()
			const attr = mesh.geometry.attributes.position
			for(let i=0; i<attr.array.length; i+=3){
				const x = k*attr.array[i]
				const y = k*attr.array[i+1]
				const z = k*attr.array[i+2]
				v.set(x,y,z)

				//旋转
				v.applyEuler(mesh.rotation)
				list.push(round_decimal(v.x,7),round_decimal(v.y,7),round_decimal(v.z,7))
			}
			geom.position = {
				array:list,
				size:attr.itemSize,
				count:attr.count
			}
		}
		if (mesh.geometry.index) {
			const list = []
			const arr = mesh.geometry.index.array
			for(let i=0; i<arr.length; i++){
				list.push(arr[i])
			}
			geom.index = {
				array:list,
				size:attr.itemSize,
				count:attr.count
			}
		}
		//颜色
		if (Array.isArray(mesh.material) && Array.isArray(mesh.geometry.groups)) {
			for(let i=0; i<mesh.geometry.groups.length; i++){
				const mat_group = mesh.geometry.groups[i]
				const mat = mesh.material[mat_group.materialIndex]
				for(let j=0; j<mat_group.count; j++){
					const r = round_decimal(mat.color.r,4)
					const g = round_decimal(mat.color.g,4)
					const b = round_decimal(mat.color.b,4)
					color.push(r, g, b)
				}
			}
			geom.color = {
				array:color,
				size:3,
				count:color.length/3
			}
		} else {
			const col = mesh.material.color
			meta.color = {r:col.r, g:col.g, b:col.b}
		}
	}
	return {geometry:geom, meta:meta}
}

function export_objc(model){
	const scale = model.scale.x
	const objc = {}
	if (model.type === 'Group') {
		model.children.forEach(function(mesh){
			if (mesh.type === 'Mesh') {
				objc[mesh.name] = mesh_to_objc(mesh, scale)
			}
		})
	}
	return objc
}

function export_model(model){
}

function load_obj(obj,mtl,opts){
}

function merge_object(obj1,obj2){
	const obj = {}
	obj1 = obj1 || {}
	obj2 = obj2 || {}
	for(let k in obj1){
		obj[k] = obj1[k]
	}
	for(let k in obj2){
		obj[k] = obj2[k]
	}
	return obj
}

function export_bm_geometry(input,output){
	//转成BufferGeometry
	output = output || {}
	if (input.type !== 'BufferGeometry') {
		input = new THREE.BufferGeometry().fromGeometry(input)
	}
	output.attributes = {}
	for(let key in input.attributes){
		//不要输出attributes里的临时的morphTarget
		if (key.indexOf('morphTarget') !== -1) {
			continue
		}

		const attr = input.attributes[key]
		const attr_out = {}
		attr_out.array = attr.array
		attr_out.itemSize = attr.itemSize
		output.attributes[key] = attr_out
	}

	if (Object.keys(input.morphAttributes).length>0) {
		output.morphAttributes = {}
		for(let morph_key in input.morphAttributes){
			const list = []
			for(let i=0; i<input.morphAttributes[morph_key].length; i++){
				const attr = input.morphAttributes[morph_key][i]
				const attr_out = {}
				attr_out.array = attr.array
				attr_out.itemSize = attr.itemSize
				attr_out.name = attr.name
				list.push(attr_out)
			}
			output.morphAttributes[morph_key] = list
		}
	}
	if (input.index) {
		const attr = input.index
		const attr_out = {}
		attr_out.array = attr.array
		attr_out.itemSize = attr.itemSize
		output.index = attr_out
	}
	return output
}

function export_bm_r(input,output){
	output = output || {}
	if (input.geometry) {
		output.geometry = export_bm_geometry(input.geometry)
	}
	if (input.children.length>0) {
		output.children = []
		for(let i=0; i<input.children.length; i++){
			output.children.push(export_bm_r(input.children[i]))
		}
	}

	if (input.name) {
		output.name = input.name
	}
	return output
}

const save_binary = (function () {
	const a = document.createElement("a")
	document.body.appendChild(a)
	a.style = "display: none"
	return function (data, name) {
		const blob = new Blob([data], {type: "octet/stream"})
		const url = window.URL.createObjectURL(blob)
		a.href = url
		a.download = name
		a.click()
		window.URL.revokeObjectURL(url)
	}
}())

function export_bm(input){
	const output = export_bm_r(input)
	const array_buffer = bm_loader.encode(output)
	const array = new Uint8Array(array_buffer)
	const bm = pako.deflate(array,{gzip:true})
	save_binary(bm,'test.bm.gz')
}

function load_bm(buf){
	const json = bm_loader.decode(buf)
	const geometry = new THREE.BufferGeometry()
	const material = new THREE.MeshBasicMaterial()
}

function load_prwm(buf){
	const data = decodePrwm(buf)
	const geometry = new THREE.BufferGeometry()
	const material = new THREE.MeshBasicMaterial()

	for(let key in data.attributes){
		const attr_raw = data.attributes[key]
		const attr = new THREE.BufferAttribute(attr_raw.values, attr_raw.cardinality)
		geometry.addAttribute(key, attr)
		if (key === 'color') {
			material.vertexColors = THREE.VertexColors
			material.color = new THREE.Color(1,1,1)
		}
	}

	if (data.indices) {
		geometry.setIndex(data.indices)
	}

	return new THREE.Mesh(geometry, material)
}

function load_objc(obj,opts){
	opts = opts || {}
	const group = new THREE.Group()
	let color_idx = 0
	for(let part_name in obj){
		const data = obj[part_name]
		const meta = merge_object(opts[part_name], data.meta)
		const geometry = new THREE.BufferGeometry()
		const material = new THREE.MeshBasicMaterial()

		for(let key in data.geometry) {
			const att = data.geometry[key]
			if (key === 'index') {
				const attr = new THREE.Uint16BufferAttribute(att.array, att.size)
				geometry.setIndex(attr)
			} else {
				const attr = new THREE.Float32BufferAttribute(att.array, att.size)
				geometry.addAttribute(key, attr)
			}
		}
		if (data.geometry.color) {
			material.vertexColors = THREE.VertexColors
			material.color = new THREE.Color(1,1,1)
		} else {
			material.color = get_color(color_idx++)
		}
		if (meta.offset) {
			material.polygonOffset = true
			material.polygonOffsetFactor = meta.offset
		}
		const mesh = new THREE.Mesh(geometry, material)
		group.add(mesh)
	}
	scene.add(group)
	return group
}

function init() {

	container = document.getElementById('canvas-area')
	camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
	camera.position.z = 3;


	scene = new THREE.Scene();

	renderer = new THREE.WebGLRenderer({antialias:true});
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setClearColor(new THREE.Color("hsl(0, 0%, 10%)"));

	container.appendChild(renderer.domElement);


	controls = new THREE.OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.25;
	controls.enableZoom = true;

	init_coord_gizmo()


	window.addEventListener('resize', onWindowResize, false);
	window.addEventListener('keydown', onKeyboardEvent, false);

}

function onWindowResize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize(window.innerWidth, window.innerHeight);

}

function onKeyboardEvent(e) {
	/*

	   if (e.code === 'KeyL') {

	   lighting = !lighting;

	   if (lighting) {

	   ambient.intensity = 0.25;
	   scene.add(keyLight);
	   scene.add(fillLight);
	   scene.add(backLight);

	   } else {

	   ambient.intensity = 1.0;
	   scene.remove(keyLight);
	   scene.remove(fillLight);
	   scene.remove(backLight);

	   }

	   }
	   */

}

const rescale_dlg = document.getElementById('rescale-dlg')
const rescale_confirm_btn = document.getElementById('rescale-confirm-btn')
const rescale_cancel_btn = document.getElementById('rescale-cancel-btn')
rescale_confirm_btn.addEventListener('click',function(){
	const sel = document.getElementById('rescale-select')
	rescale_model(sel.value)
})

rescale_confirm_btn.addEventListener('click',function(){
	current_obj.visible = true
})

function animate() {

	if (need_rescale) {
		rescale_dlg.showModal()

		need_rescale = false
	}

	requestAnimationFrame(animate);

	if (current_obj && current_obj.updateAnimation) {
		current_obj.updateAnimation(1000/60)
	}

	controls.update();

	render();

}

function render() {

	renderer.render(scene, camera);

}


