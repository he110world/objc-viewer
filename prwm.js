var bigEndianPlatform = null;

/**
 * Check if the endianness of the platform is big-endian (most significant bit first)
 * @returns {boolean} True if big-endian, false if little-endian
 */
function isBigEndianPlatform() {

	if ( bigEndianPlatform === null ) {

		var buffer = new ArrayBuffer( 2 ),
			uint8Array = new Uint8Array( buffer ),
			uint16Array = new Uint16Array( buffer );

		uint8Array[ 0 ] = 0xAA; // set first byte
		uint8Array[ 1 ] = 0xBB; // set second byte
		bigEndianPlatform = ( uint16Array[ 0 ] === 0xAABB );

	}

	return bigEndianPlatform;

}

// match the values defined in the spec to the TypedArray types
var InvertedEncodingTypes = [
	null,
	Float32Array,
	null,
	Int8Array,
	Int16Array,
	null,
	Int32Array,
	Uint8Array,
	Uint16Array,
	null,
	Uint32Array
];

// define the method to use on a DataView, corresponding the TypedArray type
var getMethods = {
	Uint16Array: 'getUint16',
	Uint32Array: 'getUint32',
	Int16Array: 'getInt16',
	Int32Array: 'getInt32',
	Float32Array: 'getFloat32',
	Float64Array: 'getFloat64'
};

function copyFromBuffer( sourceArrayBuffer, viewType, position, length, fromBigEndian ) {

	var bytesPerElement = viewType.BYTES_PER_ELEMENT,
		result;

	if ( fromBigEndian === isBigEndianPlatform() || bytesPerElement === 1 ) {

		result = new viewType( sourceArrayBuffer, position, length );

	} else {

		var readView = new DataView( sourceArrayBuffer, position, length * bytesPerElement ),
			getMethod = getMethods[ viewType.name ],
			littleEndian = ! fromBigEndian,
			i = 0;

		result = new viewType( length );

		for ( ; i < length; i ++ ) {

			result[ i ] = readView[ getMethod ]( i * bytesPerElement, littleEndian );

		}

	}

	return result;

}


function decodePrwm( buffer ) {

	var array = new Uint8Array( buffer ),
		version = array[ 0 ],
		flags = array[ 1 ],
		indexedGeometry = !! ( flags >> 7 & 0x01 ),
		indicesType = flags >> 6 & 0x01,
		bigEndian = ( flags >> 5 & 0x01 ) === 1,
		attributesNumber = flags & 0x1F,
		valuesNumber = 0,
		indicesNumber = 0;

	if ( bigEndian ) {

		valuesNumber = ( array[ 2 ] << 16 ) + ( array[ 3 ] << 8 ) + array[ 4 ];
		indicesNumber = ( array[ 5 ] << 16 ) + ( array[ 6 ] << 8 ) + array[ 7 ];

	} else {

		valuesNumber = array[ 2 ] + ( array[ 3 ] << 8 ) + ( array[ 4 ] << 16 );
		indicesNumber = array[ 5 ] + ( array[ 6 ] << 8 ) + ( array[ 7 ] << 16 );

	}

	/** PRELIMINARY CHECKS **/

	if ( version === 0 ) {

		throw new Error( 'PRWM decoder: Invalid format version: 0' );

	} else if ( version !== 1 ) {

		throw new Error( 'PRWM decoder: Unsupported format version: ' + version );

	}

	if ( ! indexedGeometry ) {

		if ( indicesType !== 0 ) {

			throw new Error( 'PRWM decoder: Indices type must be set to 0 for non-indexed geometries' );

		} else if ( indicesNumber !== 0 ) {

			throw new Error( 'PRWM decoder: Number of indices must be set to 0 for non-indexed geometries' );

		}

	}

	/** PARSING **/

	var pos = 8;

	var attributes = {},
		attributeName,
	char,
	attributeType,
	cardinality,
	encodingType,
	arrayType,
	values,
	indices,
	i;

	for ( i = 0; i < attributesNumber; i ++ ) {

		attributeName = '';

		while ( pos < array.length ) {

			char = array[ pos ];
			pos ++;

			if ( char === 0 ) {

				break;

			} else {

				attributeName += String.fromCharCode( char );

			}

		}

		flags = array[ pos ];

		attributeType = flags >> 7 & 0x01;
		cardinality = ( flags >> 4 & 0x03 ) + 1;
		encodingType = flags & 0x0F;
		arrayType = InvertedEncodingTypes[ encodingType ];

		pos ++;

		// padding to next multiple of 4
		pos = Math.ceil( pos / 4 ) * 4;

		values = copyFromBuffer( buffer, arrayType, pos, cardinality * valuesNumber, bigEndian );

		pos += arrayType.BYTES_PER_ELEMENT * cardinality * valuesNumber;

		attributes[ attributeName ] = {
			type: attributeType,
			cardinality: cardinality,
			values: values
		};

	}

	pos = Math.ceil( pos / 4 ) * 4;

	indices = null;

	if ( indexedGeometry ) {

		indices = copyFromBuffer(
			buffer,
			indicesType === 1 ? Uint32Array : Uint16Array,
			pos,
			indicesNumber,
			bigEndian
		);

	}

	return {
		version: version,
		attributes: attributes,
		indices: indices
	};

}

// match the TypedArray type with the value defined in the spec
var EncodingTypes = {
	Float32Array: 1,
	Int8Array: 3,
	Int16Array: 4,
	Int32Array: 6,
	Uint8Array: 7,
	Uint16Array: 8,
	Uint32Array: 10
};

// define the method to use on a DataView, corresponding the TypedArray type
var setMethods = {
	Uint16Array: 'setUint16',
	Uint32Array: 'setUint32',
	Int16Array: 'setInt16',
	Int32Array: 'setInt32',
	Float32Array: 'setFloat32'
};

function copyToBuffer (sourceTypedArray, destinationArrayBuffer, position, bigEndian) {
	var length = sourceTypedArray.length,
		bytesPerElement = sourceTypedArray.BYTES_PER_ELEMENT;

	var writeArray = new sourceTypedArray.constructor(destinationArrayBuffer, position, length);

	if (bigEndian === isBigEndianPlatform() || bytesPerElement === 1) {
		// desired endianness is the same as the platform, or the endianness doesn't matter (1 byte)
		writeArray.set(sourceTypedArray.subarray(0, length));
	} else {
		var writeView = new DataView(destinationArrayBuffer, position, length * bytesPerElement),
			setMethod = setMethods[sourceTypedArray.constructor.name],
			littleEndian = !bigEndian,
			i = 0;

		for (i = 0; i < length; i++) {
			writeView[setMethod](i * bytesPerElement, sourceTypedArray[i], littleEndian);
		}
	}

	return writeArray;
}

function encodePrwm (attributes, indices, bigEndian) {
	var attributeKeys = attributes ? Object.keys(attributes) : [],
		indexedGeometry = !!indices,
		i, j;

	/** PRELIMINARY CHECKS **/

	// this is not supposed to catch all the possible errors, only some of the gotchas

	if (attributeKeys.length === 0) {
		throw new Error('PRWM encoder: The model must have at least one attribute');
	}

	if (attributeKeys.length > 31) {
		throw new Error('PRWM encoder: The model can have at most 31 attributes');
	}

	for (i = 0; i < attributeKeys.length; i++) {
		if (!EncodingTypes.hasOwnProperty(attributes[attributeKeys[i]].values.constructor.name)) {
			throw new Error('PRWM encoder: Unsupported attribute values type: ' + attributes[attributeKeys[i]].values.constructor.name);
		}
	}

	if (indexedGeometry && indices.constructor.name !== 'Uint16Array' && indices.constructor.name !== 'Uint32Array') {
		throw new Error('PRWM encoder: The indices must be represented as an Uint16Array or an Uint32Array');
	}

	/** GET THE TYPE OF INDICES AS WELL AS THE NUMBER OF INDICES AND ATTRIBUTE VALUES **/

	var valuesNumber = attributes[attributeKeys[0]].values.length / attributes[attributeKeys[0]].cardinality | 0,
		indicesNumber = indexedGeometry ? indices.length : 0,
		indicesType = indexedGeometry && indices.constructor.name === 'Uint32Array' ? 1 : 0;

	/** GET THE FILE LENGTH **/

	var totalLength = 8,
		attributeKey,
	attribute,
	attributeType,
	attributeNormalized;

	for (i = 0; i < attributeKeys.length; i++) {
		attributeKey = attributeKeys[i];
		attribute = attributes[attributeKey];
		totalLength += attributeKey.length + 2; // NUL byte + flag byte + padding
		totalLength = Math.ceil(totalLength / 4) * 4; // padding
		totalLength += attribute.values.byteLength;
	}

	if (indexedGeometry) {
		totalLength = Math.ceil(totalLength / 4) * 4;
		totalLength += indices.byteLength;
	}

	/** INITIALIZE THE BUFFER */

	var buffer = new ArrayBuffer(totalLength),
		array = new Uint8Array(buffer);

	/** HEADER **/

	array[0] = 1;
	array[1] = (
		indexedGeometry << 7 |
			indicesType << 6 |
			(bigEndian ? 1 : 0) << 5 |
			attributeKeys.length & 0x1F
	);

	if (bigEndian) {
		array[2] = valuesNumber >> 16 & 0xFF;
		array[3] = valuesNumber >> 8 & 0xFF;
		array[4] = valuesNumber & 0xFF;

		array[5] = indicesNumber >> 16 & 0xFF;
		array[6] = indicesNumber >> 8 & 0xFF;
		array[7] = indicesNumber & 0xFF;
	} else {
		array[2] = valuesNumber & 0xFF;
		array[3] = valuesNumber >> 8 & 0xFF;
		array[4] = valuesNumber >> 16 & 0xFF;

		array[5] = indicesNumber & 0xFF;
		array[6] = indicesNumber >> 8 & 0xFF;
		array[7] = indicesNumber >> 16 & 0xFF;
	}


	var pos = 8;

	/** ATTRIBUTES **/

	for (i = 0; i < attributeKeys.length; i++) {
		attributeKey = attributeKeys[i];
		attribute = attributes[attributeKey];
		attributeType = typeof attribute.type === 'undefined' ? attributeTypes.Float : attribute.type;
		attributeNormalized = (!!attribute.normalized ? 1 : 0);

		/*** WRITE ATTRIBUTE HEADER ***/

		for (j = 0; j < attributeKey.length; j++, pos++) {
			array[pos] = (attributeKey.charCodeAt(j) & 0x7F) || 0x5F; // default to underscore
		}

		pos++;

		array[pos] = (
			attributeType << 7 |
			attributeNormalized << 6 |
			((attribute.cardinality - 1) & 0x03) << 4 |
				EncodingTypes[attribute.values.constructor.name] & 0x0F
		);

		pos++;


		// padding to next multiple of 4
		pos = Math.ceil(pos / 4) * 4;

		/*** WRITE ATTRIBUTE VALUES ***/

		var attributesWriteArray = copyToBuffer(attribute.values, buffer, pos, bigEndian);

		pos += attributesWriteArray.byteLength;
	}

	/*** WRITE INDICES VALUES ***/

	if (indexedGeometry) {
		pos = Math.ceil(pos / 4) * 4;

		copyToBuffer(indices, buffer, pos, bigEndian);
	}

	return buffer;
}
