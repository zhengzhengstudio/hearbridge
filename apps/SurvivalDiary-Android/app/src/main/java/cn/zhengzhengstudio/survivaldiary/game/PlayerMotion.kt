package cn.zhengzhengstudio.survivaldiary.game

import kotlin.math.hypot
import java.util.PriorityQueue

class PlayerMotion(
    var position: WorldPoint = WorldPoint(ChunkRenderer.WORLD_UNIT * 8f, ChunkRenderer.WORLD_UNIT * 8f),
    private val speed: Float = 90f,
) {
    var target: WorldPoint? = null
        private set
    private val waypoints = ArrayDeque<WorldPoint>()
    private var canEnter: (WorldPoint) -> Boolean = { true }
    var direction: Int = 1
        private set
    val isMoving: Boolean get() = target != null

    fun stop() {
        waypoints.clear()
        target = null
    }

    fun moveTo(point: WorldPoint, passability: (WorldPoint) -> Boolean = { true }): Boolean {
        val route = WorldPathPlanner.route(position, point, passability) ?: return false
        canEnter = passability
        waypoints.clear()
        waypoints.addAll(route)
        target = waypoints.removeFirstOrNull()
        return true
    }

    fun advance(seconds: Float): Boolean {
        val destination = target ?: return false
        val dx = destination.x - position.x
        val dy = destination.y - position.y
        val distance = hypot(dx, dy)
        if (distance <= 0.5f) {
            position = destination
            target = waypoints.removeFirstOrNull()
            return target != null
        }
        direction = (((Math.atan2(dy.toDouble(), dx.toDouble()) / (Math.PI * 2) * 8).toInt() + 8) % 8)
        val step = (speed * seconds.coerceAtLeast(0f)).coerceAtMost(distance)
        if (step <= 0f) return false
        val unitX = dx / distance
        val unitY = dy / distance
        var remaining = step
        var moved = false
        // Check the whole path, not only its endpoint. Large frames used to let
        // the player jump across a blocked strip or stop on the far side of it.
        while (remaining > 0f) {
            val subStep = remaining.coerceAtMost(4f)
            val candidate = WorldPoint(position.x + unitX * subStep, position.y + unitY * subStep)
            if (!canEnter(candidate)) {
                stop()
                return moved
            }
            position = candidate
            moved = true
            remaining -= subStep
        }
        if (step >= distance || hypot(destination.x - position.x, destination.y - position.y) <= 0.5f) {
            position = destination
            target = waypoints.removeFirstOrNull()
        }
        return moved
    }
}

/** Small A* planner used by tap-to-move. It searches only around the requested
 * trip and then removes unnecessary corners, so walking feels direct while still
 * going around tree trunks and compact building footprints. */
object WorldPathPlanner {
    private data class Cell(val x: Int, val y: Int)
    private data class OpenCell(val cell: Cell, val score: Float)

    fun route(
        start: WorldPoint,
        destination: WorldPoint,
        passability: (WorldPoint) -> Boolean,
        cellSize: Float = ChunkRenderer.WORLD_UNIT / 2f,
    ): List<WorldPoint>? {
        if (!passability(destination)) return null
        if (segmentIsClear(start, destination, passability)) return listOf(destination)

        val directDistance = hypot(destination.x - start.x, destination.y - start.y)
        val searchRadius = (directDistance / cellSize).toInt().coerceAtLeast(1) + 16
        val origin = Cell(0, 0)
        fun point(cell: Cell) = WorldPoint(start.x + cell.x * cellSize, start.y + cell.y * cellSize)
        fun heuristic(cell: Cell): Float {
            val value = point(cell)
            return hypot(destination.x - value.x, destination.y - value.y)
        }

        val open = PriorityQueue(compareBy<OpenCell> { it.score })
        val cameFrom = mutableMapOf<Cell, Cell>()
        val cost = mutableMapOf(origin to 0f)
        open += OpenCell(origin, heuristic(origin))
        val directions = listOf(
            Cell(1, 0), Cell(-1, 0), Cell(0, 1), Cell(0, -1),
            Cell(1, 1), Cell(1, -1), Cell(-1, 1), Cell(-1, -1),
        )
        var finish: Cell? = null
        var visited = 0
        while (open.isNotEmpty() && visited++ < 4_096) {
            val current = open.remove().cell
            val currentPoint = point(current)
            if (hypot(destination.x - currentPoint.x, destination.y - currentPoint.y) <= cellSize * 1.45f &&
                segmentIsClear(currentPoint, destination, passability)
            ) {
                finish = current
                break
            }
            directions.forEach { delta ->
                val next = Cell(current.x + delta.x, current.y + delta.y)
                if (kotlin.math.abs(next.x) > searchRadius || kotlin.math.abs(next.y) > searchRadius) return@forEach
                val nextPoint = point(next)
                if (!passability(nextPoint) || !segmentIsClear(currentPoint, nextPoint, passability)) return@forEach
                val step = if (delta.x != 0 && delta.y != 0) cellSize * 1.414214f else cellSize
                val nextCost = cost.getValue(current) + step
                if (nextCost >= (cost[next] ?: Float.POSITIVE_INFINITY)) return@forEach
                cost[next] = nextCost
                cameFrom[next] = current
                open += OpenCell(next, nextCost + heuristic(next))
            }
        }
        val last = finish ?: return null
        val reversed = mutableListOf<WorldPoint>()
        var cursor = last
        while (cursor != origin) {
            reversed += point(cursor)
            cursor = cameFrom[cursor] ?: return null
        }
        val raw = reversed.asReversed() + destination
        if (raw.isEmpty()) return listOf(destination)

        // Greedily skip visible intermediate cells. This removes the rigid
        // stair-step shape produced by the grid without cutting through trunks.
        val smoothed = mutableListOf<WorldPoint>()
        var anchor = start
        var index = 0
        while (index < raw.size) {
            var furthest = index
            while (furthest + 1 < raw.size && segmentIsClear(anchor, raw[furthest + 1], passability)) furthest++
            val next = raw[furthest]
            smoothed += next
            anchor = next
            index = furthest + 1
        }
        return smoothed
    }

    private fun segmentIsClear(start: WorldPoint, end: WorldPoint, passability: (WorldPoint) -> Boolean): Boolean {
        val distance = hypot(end.x - start.x, end.y - start.y)
        if (distance <= 0.5f) return passability(end)
        val samples = (distance / 4f).toInt().coerceAtLeast(1)
        for (index in 1..samples) {
            val progress = index.toFloat() / samples
            if (!passability(WorldPoint(start.x + (end.x - start.x) * progress, start.y + (end.y - start.y) * progress))) return false
        }
        return true
    }
}
