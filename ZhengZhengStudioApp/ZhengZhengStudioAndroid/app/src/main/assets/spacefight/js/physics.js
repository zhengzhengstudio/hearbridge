var PHYSICS = {
    clamp: function(value, min, max) {
        return Math.max(min, Math.min(max, value));
    },
    distance2D: function(a, b) {
        var dx = a.x - b.x;
        var dz = a.z - b.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
};
