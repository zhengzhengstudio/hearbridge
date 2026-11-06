function discoveredEntity(entity, discovery) {
  if (discovery === true) return true;
  if (discovery?.entityIds?.includes(entity.id)) return true;
  const chunk = entity.chunk || entity.chunkId;
  if (chunk && (discovery?.chunkIds?.includes(chunk) || discovery?.discoveredChunks?.[chunk])) return true;
  return false;
}

function visibilityFor(entity, camera, discovery, quality = 'high') {
  if (!entity || entity.hidden === true) return 'hidden';
  if (entity.tracked === true || entity.highlighted === true || discovery?.trackedEntityId === entity.id) {
    return 'highlighted';
  }
  if (!discoveredEntity(entity, discovery)) return 'silhouette';

  const zoom = Math.max(0.01, Number(camera?.zoom || 1));
  const importance = entity.importance || 'ordinary';
  const minimumZoom = importance === 'landmark' ? 0.25 : importance === 'important' ? 0.45 : 0.7;
  if (quality === 'low' && zoom < minimumZoom) return 'hidden';
  if (zoom < minimumZoom * 0.75) return 'hidden';
  if (quality === 'low' || zoom < 1) return 'silhouette';
  return 'detailed';
}

module.exports = { visibilityFor };
