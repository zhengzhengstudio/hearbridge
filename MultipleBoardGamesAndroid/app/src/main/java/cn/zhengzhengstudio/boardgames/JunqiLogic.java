package cn.zhengzhengstudio.boardgames;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * 陆战棋（军棋）暗棋规则引擎。
 *
 * 棋规要点：
 *  - 棋盘 12 行 × 5 列 = 60 个兵站，index = row * 5 + col。
 *  - 己方 25 子全部明牌，敌方 25 子全部为「暗子」，只有发生碰撞（进攻/被进攻）后才双向揭晓。
 *  - 地雷不能动、军旗不能动；工兵可沿铁路任意折线长途机动；行营内的子八向连通。
 *  - 大本营不可进入，行营内的子不可被吃。
 *  - 争夺军旗即获胜；无子可动判负。
 */
public final class JunqiLogic {

    public static final int N = 60;
    public static final int ROWS = 12;
    public static final int COLS = 5;

    /** 大本营：红方 56/58，蓝方 1/3 */
    public static final int[] BASE = {1, 3, 56, 58};
    /** 行营（安全格，八向连通，不可吃子） */
    public static final int[] CAMP = {5, 7, 9, 16, 18, 41, 43, 50, 52, 54};

    private static final String[] RANK_LIST = {
            "9", "8", "7", "7", "6", "6", "5", "5", "4", "4",
            "3", "3", "3", "2", "2", "2", "1", "1", "1", "B", "B"
    };

    public final String[] board = new String[N];
    /** 玩家视角已知表 */
    public final boolean[] known = new boolean[N];
    /** AI 视角已知表（AI 不作弊，只看这张表） */
    public final boolean[] aiKnown = new boolean[N];
    /** 当前行棋方：'r' 红（玩家） / 'b' 蓝（AI） */
    public char turn = 'r';

    public boolean finished = false;
    public String status = "";

    private final Random random;

    public JunqiLogic() {
        this(new Random());
    }

    public JunqiLogic(Random random) {
        this.random = random;
        reset();
    }

    // ------------------------------------------------------------------ 工具

    public static char sideOf(String cell) {
        return cell != null && cell.length() > 0 ? cell.charAt(0) : ' ';
    }

    /** 军衔：-2 军旗 / -1 炸弹 / 0 地雷 / 1 工兵 … 9 司令 */
    public static int rankOf(String cell) {
        if (cell == null || cell.length() < 2) return 0;
        char t = cell.charAt(1);
        if (t == 'F') return -2;
        if (t == 'B') return -1;
        if (t == 'M') return 0;
        if (t >= '1' && t <= '9') return t - '0';
        return 9;
    }

    public static String nameOf(String cell) {
        char t = cell.charAt(1);
        switch (t) {
            case 'F': return "军旗";
            case 'B': return "炸弹";
            case 'M': return "地雷";
            case '9': return "司令";
            case '8': return "军长";
            case '7': return "师长";
            case '6': return "旅长";
            case '5': return "团长";
            case '4': return "营长";
            case '3': return "连长";
            case '2': return "排长";
            default: return "工兵";
        }
    }

    public static String shortName(String cell) {
        char t = cell.charAt(1);
        switch (t) {
            case 'F': return "旗";
            case 'B': return "炸";
            case 'M': return "雷";
            case '9': return "令";
            case '8': return "军";
            case '7': return "师";
            case '6': return "旅";
            case '5': return "团";
            case '4': return "营";
            case '3': return "连";
            case '2': return "排";
            default: return "兵";
        }
    }

    public static boolean movable(String cell) {
        if (cell == null || cell.length() == 0) return false;
        char t = cell.charAt(1);
        return t != 'F' && t != 'M';
    }

    /** 面向玩家的显示名（未揭晓的敌方一律「暗子」） */
    public String labelAt(int index) {
        String cell = board[index];
        if (cell == null || cell.length() == 0) return "";
        return known[index] ? nameOf(cell) : "暗子";
    }

    private static boolean contains(int[] array, int value) {
        for (int v : array) if (v == value) return true;
        return false;
    }

    private static int indexOf(int[] array, int value) {
        for (int i = 0; i < array.length; i++) if (array[i] == value) return i;
        return -1;
    }

    // -------------------------------------------------------------- 开局布局

    public void reset() {
        String[] next = setup();
        System.arraycopy(next, 0, board, 0, N);
        for (int i = 0; i < N; i++) {
            known[i] = board[i].length() > 0 && sideOf(board[i]) == 'r';
            aiKnown[i] = board[i].length() > 0 && sideOf(board[i]) == 'b';
        }
        turn = 'r';
        finished = false;
        status = "暗棋模式 · 你是红方（明牌），蓝方为暗子，碰撞后即揭晓 · 红方先手";
    }

    private String[] setup() {
        String[] next = new String[N];
        for (int i = 0; i < N; i++) next[i] = "";
        for (int s = 0; s < 2; s++) {
            char side = s == 0 ? 'b' : 'r';
            int startRow = s == 0 ? 0 : 6;
            int[] backRows = s == 0 ? new int[]{0, 1} : new int[]{10, 11};
            int baseA = s == 0 ? 1 : 56;
            int baseB = s == 0 ? 3 : 58;
            int flagBase = random.nextBoolean() ? baseA : baseB;
            int mineBase = flagBase == baseA ? baseB : baseA;
            next[flagBase] = side + "F";
            next[mineBase] = side + "M";

            List<Integer> spots = new ArrayList<>();
            for (int r = startRow; r < startRow + 6; r++) {
                for (int col = 0; col < COLS; col++) {
                    int idx = r * COLS + col;
                    if (contains(BASE, idx) || contains(CAMP, idx)) continue;
                    if (next[idx].length() > 0) continue;
                    spots.add(idx);
                }
            }
            shuffle(spots);

            // 剩余 2 枚地雷必须落在后两排
            List<Integer> mineSpots = new ArrayList<>();
            List<Integer> restSpots = new ArrayList<>();
            for (Integer idx : spots) {
                if (contains(backRows, idx / COLS)) mineSpots.add(idx);
                else restSpots.add(idx);
            }
            shuffle(mineSpots);
            for (int m = 0; m < 2 && m < mineSpots.size(); m++) next[mineSpots.get(m)] = side + "M";
            for (int m = 2; m < mineSpots.size(); m++) restSpots.add(mineSpots.get(m));

            List<String> rest = new ArrayList<>();
            for (String rk : RANK_LIST) rest.add(side + rk);
            shuffle(rest);
            for (int i = 0; i < restSpots.size() && i < rest.size(); i++) next[restSpots.get(i)] = rest.get(i);
        }
        return next;
    }

    private void shuffle(List<?> list) {
        for (int i = list.size() - 1; i > 0; i--) {
            int j = random.nextInt(i + 1);
            java.util.Collections.swap(list, i, j);
        }
    }

    // ---------------------------------------------------------------- 走子规则

    /**
     * 铁路拓扑：横向铁路为每方前线两排（row 4..7 全线）；两侧 col0/col4 纵向全程贯通；
     * 行对 4-5、6-7 之间任意列的竖向段也是铁路，形成铁路环。
     */
    public static boolean isRail(int a, int b) {
        int ra = a / COLS, ca = a % COLS;
        int rb = b / COLS, cb = b % COLS;
        if (ra == rb) return ra >= 4 && ra <= 7;
        if (Math.abs(ra - rb) != 1) return false;
        int hi = Math.max(ra, rb);
        if (hi == 5 || hi == 7) return true;
        return ca == cb && (ca == 0 || ca == COLS - 1);
    }

    private boolean canEnter(int from, int to) {
        if (contains(BASE, to)) return false;
        String target = board[to];
        if (target.length() == 0) return true;
        if (sideOf(target) == sideOf(board[from])) return false;
        if (contains(CAMP, to)) return false;
        return true;
    }

    /** 工兵沿铁路的长途机动（BFS，遇子停止但可吃掉可达的敌子） */
    private List<Integer> engineerTargets(int from) {
        List<Integer> out = new ArrayList<>();
        boolean[] seen = new boolean[N];
        seen[from] = true;
        int[] queue = new int[N];
        int head = 0, tail = 0;
        queue[tail++] = from;
        int[][] dirs = {{-1, 0}, {1, 0}, {0, -1}, {0, 1}};
        while (head < tail) {
            int cur = queue[head++];
            int r = cur / COLS;
            int col = cur % COLS;
            for (int[] d : dirs) {
                int nr = r + d[0];
                int nc = col + d[1];
                if (nr < 0 || nr > ROWS - 1 || nc < 0 || nc > COLS - 1) continue;
                int to = nr * COLS + nc;
                if (seen[to] || !isRail(cur, to)) continue;
                seen[to] = true;
                String t = board[to];
                if (t.length() == 0) {
                    if (!contains(BASE, to)) out.add(to);
                    queue[tail++] = to;
                } else if (canEnter(from, to)) {
                    out.add(to);
                }
            }
        }
        return out;
    }

    public List<Integer> movesFrom(int index) {
        List<Integer> out = new ArrayList<>();
        String cell = board[index];
        if (cell == null || cell.length() == 0 || !movable(cell)) return out;
        int r = index / COLS;
        int col = index % COLS;
        boolean inCamp = contains(CAMP, index);
        int[][] dirs = inCamp
                ? new int[][]{{-1, 0}, {1, 0}, {0, -1}, {0, 1}, {-1, -1}, {-1, 1}, {1, -1}, {1, 1}}
                : new int[][]{{-1, 0}, {1, 0}, {0, -1}, {0, 1}};
        for (int[] d : dirs) {
            int nr = r + d[0];
            int nc = col + d[1];
            if (nr < 0 || nr > ROWS - 1 || nc < 0 || nc > COLS - 1) continue;
            int to = nr * COLS + nc;
            if (d[0] != 0 && d[1] != 0 && !inCamp && !contains(CAMP, to)) continue;
            if (canEnter(index, to)) out.add(to);
        }
        if (rankOf(cell) == 1) {
            for (Integer t : engineerTargets(index)) {
                if (!out.contains(t)) out.add(t);
            }
        }
        return out;
    }

    public boolean sideHasMove(char side) {
        for (int i = 0; i < N; i++) {
            String cell = board[i];
            if (cell.length() == 0 || sideOf(cell) != side) continue;
            if (!movesFrom(i).isEmpty()) return true;
        }
        return false;
    }

    private void reveal(int... indexes) {
        for (int i : indexes) {
            if (i >= 0 && i < N) {
                known[i] = true;
                aiKnown[i] = true;
            }
        }
    }

    private int findFlag(char side) {
        for (int i = 0; i < N; i++) if ((side + "F").equals(board[i])) return i;
        return -1;
    }

    /** 执行一次走子，返回给玩家看的战报 */
    public String applyMove(int from, int to) {
        String attacker = board[from];
        if (attacker == null || attacker.length() == 0) return "";
        String defender = board[to];
        String aSide = sideOf(attacker) == 'r' ? "红" : "蓝";
        board[from] = "";
        String text;
        if (defender.length() == 0) {
            board[to] = attacker;
            // 己方明牌要跟着棋子走，否则移动后自己人反而显示成暗子
            if (sideOf(attacker) == 'r') known[to] = true;
            else aiKnown[to] = true;
            known[from] = false;
            aiKnown[from] = false;
            text = aSide + "方" + nameOf(attacker) + "移动";
        } else {
            // 暗棋：交火即双向亮明，这是获取情报的唯一途径
            reveal(from, to);
            String name = aSide + "方" + nameOf(attacker);
            int aRank = rankOf(attacker);
            int dRank = rankOf(defender);
            String dSide = sideOf(defender) == 'r' ? "红" : "蓝";
            String dName = dSide + "方" + nameOf(defender);
            if (dRank == -2) {
                board[to] = attacker;
                if (sideOf(attacker) == 'r') known[to] = true;
                else aiKnown[to] = true;
                text = name + "夺得" + dName + "，获胜！";
            } else if (dRank == 0 && aRank == 1) {
                board[to] = attacker;
                if (sideOf(attacker) == 'r') known[to] = true;
                else aiKnown[to] = true;
                text = name + "挖掉" + dName;
            } else if (dRank == 0) {
                text = name + "触雷阵亡";
            } else if (dRank == -1 || aRank == -1) {
                text = name + "与" + dName + "同归于尽";
            } else if (aRank > dRank) {
                board[to] = attacker;
                if (sideOf(attacker) == 'r') known[to] = true;
                else aiKnown[to] = true;
                text = name + "吃掉" + dName;
            } else if (aRank == dRank) {
                text = name + "与" + dName + "对拼，双双阵亡";
            } else {
                text = name + "进攻" + dName + "失败，阵亡";
            }
        }
        char moverSide = sideOf(attacker);
        char nextSide = moverSide == 'r' ? 'b' : 'r';
        if (text.contains("获胜")) {
            finished = true;
            status = text;
            return text;
        }
        if (!sideHasMove(nextSide)) {
            finished = true;
            status = text + " · " + (nextSide == 'r' ? "红" : "蓝") + "方无子可动，"
                    + (moverSide == 'r' ? "红" : "蓝") + "方获胜！";
            return status;
        }
        turn = nextSide;
        status = text + " · 轮到" + (nextSide == 'r' ? "红" : "蓝") + "方";
        return status;
    }

    /** 返回提示用的一步（选中有走法的己方棋子下标），没有则返回 -1 */
    public int hintIndex() {
        char side = turn;
        for (int i = 0; i < N; i++) {
            String cell = board[i];
            if (cell.length() == 0 || sideOf(cell) != side || !movable(cell)) continue;
            if (!movesFrom(i).isEmpty()) return i;
        }
        return -1;
    }

    // -------------------------------------------------------------------- AI

    public static final class Move {
        public final int from;
        public final int to;

        public Move(int from, int to) {
            this.from = from;
            this.to = to;
        }
    }

    /** AI 选步：完全基于 aiKnown 表，不作弊 */
    public Move pickMove() {
        char side = turn;
        Move best = null;
        double bestScore = -1.0;
        for (int i = 0; i < N; i++) {
            String cell = board[i];
            if (cell.length() == 0 || sideOf(cell) != side || !movable(cell)) continue;
            for (Integer dst : movesFrom(i)) {
                double score = random.nextDouble() * 2;
                String target = board[dst];
                if (target.length() > 0) {
                    int dRank = rankOf(target);
                    int aRank = rankOf(cell);
                    if (!aiKnown[dst]) {
                        if (aRank == -1) score += 12;
                        else if (aRank == 9) score += 14;
                        else if (aRank == 1) score += 3;
                        else score += 5;
                    } else if (dRank == -2) {
                        score += 1000;
                    } else if (dRank == 0 && aRank == 1) {
                        score += 60;
                    } else if (dRank == 0) {
                        score -= 5;
                    } else if (dRank == -1) {
                        score += aRank >= 7 ? 30 : -10;
                    } else if (aRank > dRank) {
                        score += 10 + dRank * 3;
                    } else if (aRank == dRank) {
                        score += aRank >= 7 ? -8 : 4;
                    } else {
                        score -= 6 + aRank;
                    }
                } else {
                    char foe = side == 'r' ? 'b' : 'r';
                    int enemyFlag = findFlag(foe);
                    if (enemyFlag >= 0 && side == 'b' && !aiKnown[enemyFlag]) enemyFlag = 57;
                    if (enemyFlag >= 0) {
                        int dr = Math.abs(dst / COLS - enemyFlag / COLS) + Math.abs(dst % COLS - enemyFlag % COLS);
                        int dr0 = Math.abs(i / COLS - enemyFlag / COLS) + Math.abs(i % COLS - enemyFlag % COLS);
                        score += Math.max(0, dr0 - dr);
                    }
                }
                if (score > bestScore) {
                    bestScore = score;
                    best = new Move(i, dst);
                }
            }
        }
        return best;
    }
}
