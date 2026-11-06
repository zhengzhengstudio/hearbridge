package cn.zhengzhengstudio.boardgames;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * 中国跳棋（六角星）规则引擎。
 *
 * 棋盘为 121 孔六角星，三家对弈：红（顶）→ 底部营地，黄（左下）→ 右上营地，蓝（右下）→ 左上营地。
 * 走法：相邻一步，或沿直线连续跳跃（每次跳过恰好一枚棋子落到其正后方空格）。
 * 先把 10 枚棋子全部送进对面营地者获胜。
 */
public final class JumpLogic {

    public static final int N = 121;
    public static final int ROWS = 17;

    /** 每行孔数（六角星） */
    public static final int[] ROW_COUNT = {1, 2, 3, 4, 13, 12, 11, 10, 9, 10, 11, 12, 13, 4, 3, 2, 1};

    /** 三家初始营地 */
    public static final int[][] HOMES = {
            {0, 1, 2, 3, 4, 5, 6, 7, 8, 9},
            {65, 75, 76, 86, 87, 88, 98, 99, 100, 101},
            {74, 84, 85, 95, 96, 97, 107, 108, 109, 110}
    };

    /** 三家目标营地（正对面） */
    public static final int[][] GOALS = {
            {111, 112, 113, 114, 115, 116, 117, 118, 119, 120},
            {19, 20, 21, 22, 32, 33, 34, 44, 45, 55},
            {10, 11, 12, 13, 23, 24, 25, 35, 36, 46}
    };

    public static final String[] SIDE_NAMES = {"红方", "黄方", "蓝方"};

    /** 121 孔的中心坐标（百分比，与底图生成器同源） */
    private static final float[] POS_X = new float[N];
    private static final float[] POS_Y = new float[N];
    /** 每孔所在行 */
    private static final int[] INDEX_ROW = new int[N];
    /** 每孔的横向格位（0.5 为半格，用于六角邻接判断） */
    private static final float[] INDEX_UX = new float[N];
    private static final int[][] NEIGHBORS = new int[N][];

    static {
        int index = 0;
        for (int r = 0; r < ROWS; r++) {
            float start = -(ROW_COUNT[r] - 1) / 2.0f;
            for (int c = 0; c < ROW_COUNT[r]; c++) {
                INDEX_ROW[index] = r;
                INDEX_UX[index] = start + c;
                POS_X[index] = 50.0f + (start + c) * 7.35f;
                index++;
            }
        }
        // 纵向：0 行 5.18%，16 行 94.9%，中间行间距 5.6075%
        index = 0;
        for (int r = 0; r < ROWS; r++) {
            float y = 5.18f + r * 5.6075f;
            for (int c = 0; c < ROW_COUNT[r]; c++) POS_Y[index++] = y;
        }
        for (int i = 0; i < N; i++) {
            List<Integer> list = new ArrayList<>();
            for (int j = 0; j < N; j++) {
                if (i == j) continue;
                int dr = Math.abs(INDEX_ROW[i] - INDEX_ROW[j]);
                float dx = Math.abs(INDEX_UX[i] - INDEX_UX[j]);
                if ((dr == 0 && Math.abs(dx - 1) < 0.01f) || (dr == 1 && Math.abs(dx - 0.5f) < 0.01f)) {
                    list.add(j);
                }
            }
            int[] array = new int[list.size()];
            for (int k = 0; k < array.length; k++) array[k] = list.get(k);
            NEIGHBORS[i] = array;
        }
    }

    /** board[i]：0 空 / 1 红 / 2 黄 / 3 蓝 */
    public final int[] board = new int[N];
    /** 当前行棋方 1..3 */
    public int turn = 1;
    public boolean finished = false;
    public String status = "";

    private final Random random;

    public JumpLogic() {
        this(new Random());
    }

    public JumpLogic(Random random) {
        this.random = random;
        reset();
    }

    public void reset() {
        for (int i = 0; i < N; i++) board[i] = 0;
        for (int p = 1; p <= 3; p++) {
            for (int cell : HOMES[p - 1]) board[cell] = p;
        }
        turn = 1;
        finished = false;
        status = "中国跳棋 · 三家轮走，先把 10 枚棋子送进对面营地者获胜 · 红方先手";
    }

    public static float posX(int index) {
        return POS_X[index];
    }

    public static float posY(int index) {
        return POS_Y[index];
    }

    private static boolean inArray(int[] array, int value) {
        for (int v : array) if (v == value) return true;
        return false;
    }

    /**
     * 从 from 出发的全部落点：相邻一步 + 任意长度连跳。
     * 已在对面营地内的棋子不许再离开营地。
     */
    public List<Integer> reachable(int from, int piece) {
        List<Integer> out = new ArrayList<>();
        int[] goal = GOALS[piece - 1];
        boolean inGoal = inArray(goal, from);
        boolean[] seen = new boolean[N];
        seen[from] = true;
        for (int n : NEIGHBORS[from]) {
            if (board[n] == 0 && (!inGoal || inArray(goal, n))) {
                out.add(n);
                seen[n] = true;
            }
        }
        int[] queue = new int[N];
        int head = 0, tail = 0;
        queue[tail++] = from;
        while (head < tail) {
            int cur = queue[head++];
            for (int mid : NEIGHBORS[cur]) {
                if (board[mid] == 0) continue;
                int landRow = 2 * INDEX_ROW[mid] - INDEX_ROW[cur];
                float landUx = 2 * INDEX_UX[mid] - INDEX_UX[cur];
                if (landRow < 0 || landRow >= ROWS) continue;
                for (int land = 0; land < N; land++) {
                    if (seen[land] || INDEX_ROW[land] != landRow) continue;
                    if (Math.abs(INDEX_UX[land] - landUx) > 0.01f) continue;
                    if (board[land] != 0) continue;
                    if (inGoal && !inArray(goal, land)) break;
                    seen[land] = true;
                    out.add(land);
                    queue[tail++] = land;
                    break;
                }
            }
        }
        return out;
    }

    private boolean goalFull(int piece) {
        for (int cell : GOALS[piece - 1]) if (board[cell] != piece) return false;
        return true;
    }

    public String applyMove(int from, int to) {
        board[to] = board[from];
        board[from] = 0;
        for (int p = 1; p <= 3; p++) {
            if (goalFull(p)) {
                finished = true;
                status = SIDE_NAMES[p - 1] + "率先占满对面营地，获胜！";
                return status;
            }
        }
        turn = turn == 3 ? 1 : turn + 1;
        status = "轮到" + SIDE_NAMES[turn - 1] + "走子（点己方棋子，再点高亮位置）";
        return status;
    }

    /** 提示：返回一枚有走法的己方棋子下标 */
    public int hintIndex() {
        for (int i = 0; i < N; i++) {
            if (board[i] != turn) continue;
            if (!reachable(i, turn).isEmpty()) return i;
        }
        return -1;
    }

    public static final class Move {
        public final int from;
        public final int to;

        public Move(int from, int to) {
            this.from = from;
            this.to = to;
        }
    }

    /** 以「目标角距离场」评分：优先缩短进营距离，优先跳占营地 */
    public Move pickMove() {
        int piece = turn;
        int[] goal = GOALS[piece - 1];
        int[] dist = new int[N];
        for (int i = 0; i < N; i++) dist[i] = 999;
        int[] queue = new int[N * 4];
        int head = 0, tail = 0;
        for (int g : goal) {
            dist[g] = 0;
            queue[tail++] = g;
        }
        while (head < tail) {
            int cur = queue[head++];
            for (int n : NEIGHBORS[cur]) {
                if (dist[n] > dist[cur] + 1) {
                    dist[n] = dist[cur] + 1;
                    queue[tail++] = n;
                }
            }
        }
        int bestFrom = -1, bestTo = -1;
        double bestValue = -9999;
        for (int from = 0; from < N; from++) {
            if (board[from] != piece) continue;
            for (Integer to : reachable(from, piece)) {
                double value = (dist[from] - dist[to]) * 10.0;
                if (inArray(goal, to)) value += 6;
                value += random.nextDouble() * 2;
                if (value > bestValue) {
                    bestValue = value;
                    bestFrom = from;
                    bestTo = to;
                }
            }
        }
        return bestFrom >= 0 ? new Move(bestFrom, bestTo) : null;
    }
}
