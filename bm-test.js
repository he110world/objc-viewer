const BM = require('./bare-metal.js')
const bm = new BM()

const list1 = []
const list2 = []
const COUNT = 10
for(let i=0; i<COUNT; i++){
	list1[i] = i/COUNT
	list2[i] = i
}

const obj = {key1:'haha',key2:2,key3:{key4:new Float32Array(list1),key5:{key6:new Int32Array(list2)}}}
console.log(1,obj)

console.time(1)
const buf = bm.encode(obj)
console.timeEnd(1)

console.time(2)
const obj2 = bm.decode(buf)
console.timeEnd(2)

console.log(2,obj2)

//console.log(Buffer.from(buf))
