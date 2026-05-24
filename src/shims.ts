/**
 * @param map
 * @param key
 * @param defaultValue
 * @returns
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map/getOrInsert Map.prototype.getOrInsert()}
 */
export function getOrInsert<K, V>(map: Map<K, V>, key: K, defaultValue: V): V {
    if (map.has(key)) {
        return map.get(key)!;
    }
    else {
        map.set(key, defaultValue);

        return defaultValue;
    }
}
