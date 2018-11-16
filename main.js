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

	PNG:10,
	JPG:11,
}

function get_file_type(file){
	const name = file.name
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
				const obj = JSON.parse(str)
				last_obj = load_objc(obj,debug_opts)
			} else if (file_type===FileType.FBX) {
				if (!fbx_loader) {
					fbx_loader = new THREE.FBXLoader()
				}
				last_obj = fbx_loader.parse(buf)
				scene.add(last_obj)
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

let last_obj, decoder, fbx_loader
function handleDrop(e) {
	if (last_obj) {
		scene.remove(last_obj)
	}
	window.image_dict = {}

	for(let i=0; i<e.dataTransfer.items.length; i++){
		const item = e.dataTransfer.items[i].webkitGetAsEntry()
		if (item) {
			traverse_file_tree(item, read_file)
		}
	}
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
	return color_palette[idx]
}


//把fbx转成objc


function load_objc(obj,opts){
	opts = opts || {}
	const group = new THREE.Group()
	let color_idx = 0
	for(let part_name in obj){
		const data = obj[part_name]
		const meta = opts[part_name] || data.meta || {}
		const geometry = new THREE.BufferGeometry()
		const material = new THREE.MeshBasicMaterial({color:get_color(color_idx++)})
		if (data.positions) {
			const attr = new THREE.Float32BufferAttribute(data.positions,3)
			geometry.addAttribute('position', attr)
		}
		if (data.indices) {
			const attr = new THREE.Uint16BufferAttribute(data.indices,1)
			geometry.setIndex(attr)
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
	//container = document.createElement('div');
	//document.body.appendChild(container);


	camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 10000);
	camera.position.z = 3;


	scene = new THREE.Scene();
	lighting = false;

	renderer = new THREE.WebGLRenderer({antialias:true});
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setClearColor(new THREE.Color("hsl(0, 0%, 10%)"));

	container.appendChild(renderer.domElement);


	controls = new THREE.OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.25;
	controls.enableZoom = false;


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

function animate() {

	requestAnimationFrame(animate);

	controls.update();

	render();

}

function render() {

	renderer.render(scene, camera);

}


