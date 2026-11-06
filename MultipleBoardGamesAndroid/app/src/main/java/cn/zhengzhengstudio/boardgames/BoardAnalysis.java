package cn.zhengzhengstudio.boardgames;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Pure Java rules, local analysis and handoff protocol for the three study boards. */
public final class BoardAnalysis {
    public static final int PROTOCOL_VERSION = 1;

    private static final Map<Character, Integer> XIANGQI_VALUES = new HashMap<>();
    static {
        XIANGQI_VALUES.put('K', 100_000);
        XIANGQI_VALUES.put('R', 900);
        XIANGQI_VALUES.put('C', 450);
        XIANGQI_VALUES.put('N', 400);
        XIANGQI_VALUES.put('B', 200);
        XIANGQI_VALUES.put('A', 200);
        XIANGQI_VALUES.put('P', 100);
    }

    private BoardAnalysis() {}

    public enum Difficulty {
        EASY(1, 10), STANDARD(2, 28), CHALLENGE(3, 80);

        final int replyDepth;
        final int candidateLimit;

        Difficulty(int replyDepth, int candidateLimit) {
            this.replyDepth = replyDepth;
            this.candidateLimit = candidateLimit;
        }

        public static Difficulty fromLevel(int level) {
            if (level <= 1) return EASY;
            if (level >= 3) return CHALLENGE;
            return STANDARD;
        }
    }

    public static final class Position {
        public final int version;
        public final String game;
        public final int size;
        public final String[] board;
        public final int currentPlayer;
        public final List<String[]> history;

        public Position(String game, int size, String[] board, int currentPlayer) {
            this(game, size, board, currentPlayer, Collections.emptyList());
        }

        public Position(String game, int size, String[] board, int currentPlayer, List<String[]> history) {
            this.version = PROTOCOL_VERSION;
            this.game = normalizeGame(game);
            this.size = this.game.equals("xiangqi") ? 0 : (size > 0 ? size : this.game.equals("go") ? 19 : 15);
            int expected = this.game.equals("xiangqi") ? 90 : this.size * this.size;
            this.board = normalizedBoard(board, expected);
            this.currentPlayer = currentPlayer == 2 ? 2 : 1;
            this.history = new ArrayList<>();
            if (history != null) {
                for (String[] previous : history) this.history.add(normalizedBoard(previous, expected));
            }
        }
    }

    public static final class Move {
        public final int index;
        public final int from;
        public final int to;
        public final String capture;
        public int score;

        public Move(int index) {
            this(index, -1, -1, "");
        }

        public Move(int from, int to) {
            this(-1, from, to, "");
        }

        private Move(int index, int from, int to, String capture) {
            this.index = index;
            this.from = from;
            this.to = to;
            this.capture = capture == null ? "" : capture;
        }

        private Move withCapture(String value) {
            return new Move(index, from, to, value);
        }
    }

    public static final class ApplyResult {
        public final boolean ok;
        public final String reason;
        public final Position position;
        public final List<Integer> captures;

        private ApplyResult(boolean ok, String reason, Position position, List<Integer> captures) {
            this.ok = ok;
            this.reason = reason;
            this.position = position;
            this.captures = captures;
        }
    }

    public static final class Analysis {
        public final boolean ok;
        public final int score;
        public final List<Move> candidates;
        public final Move recommended;
        public final String explanation;
        public final int nodes;
        public final double confidence;
        public final String tactical;
        public final List<Move> principalVariation;

        private Analysis(boolean ok, int score, List<Move> candidates, Move recommended,
                         String explanation, int nodes, double confidence, String tactical,
                         List<Move> principalVariation) {
            this.ok = ok;
            this.score = score;
            this.candidates = candidates;
            this.recommended = recommended;
            this.explanation = explanation;
            this.nodes = nodes;
            this.confidence = confidence;
            this.tactical = tactical;
            this.principalVariation = principalVariation;
        }
    }

    public static final class Validation {
        public final boolean ok;
        public final String message;

        private Validation(boolean ok, String message) {
            this.ok = ok;
            this.message = message;
        }
    }

    public static final class Puzzle {
        public final String id;
        public final Position position;
        public final String title;
        public final String goal;
        public final String difficulty;
        public final List<Move> solution;

        private Puzzle(String id, Position position, String title, String goal,
                       String difficulty, List<Move> solution) {
            this.id = id;
            this.position = position;
            this.title = title;
            this.goal = goal;
            this.difficulty = difficulty;
            this.solution = solution;
        }
    }

    public static final class PuzzleResult {
        public final boolean ok;
        public final boolean solved;
        public final String message;
        public final Position position;

        private PuzzleResult(boolean ok, boolean solved, String message, Position position) {
            this.ok = ok;
            this.solved = solved;
            this.message = message;
            this.position = position;
        }
    }

    public static final class RoomInvite {
        public final int version;
        public final String purpose;
        public final String game;
        public final String room;
        public final String token;
        public final long expiresAt;

        private RoomInvite(int version, String purpose, String game, String room, String token, long expiresAt) {
            this.version = version;
            this.purpose = purpose;
            this.game = game;
            this.room = room;
            this.token = token;
            this.expiresAt = expiresAt;
        }
    }

    public static final class InviteResult {
        public final boolean ok;
        public final String reason;
        public final RoomInvite invite;

        private InviteResult(boolean ok, String reason, RoomInvite invite) {
            this.ok = ok;
            this.reason = reason;
            this.invite = invite;
        }
    }

    public static Validation validateEditor(Position position) {
        if (position == null) return new Validation(false, "棋局为空");
        if (!Arrays.asList("gobang", "go", "xiangqi").contains(position.game)) {
            return new Validation(false, "不支持的棋种");
        }
        int expected = position.game.equals("xiangqi") ? 90 : position.size * position.size;
        if (position.board.length != expected) return new Validation(false, "棋盘位置数量不正确");
        if (position.game.equals("xiangqi")) {
            if (count(position.board, "rK") != 1) return new Validation(false, "红方帅数量必须为 1");
            if (count(position.board, "bK") != 1) return new Validation(false, "黑方将数量必须为 1");
        } else {
            for (String value : position.board) {
                if (!value.isEmpty() && !value.equals("1") && !value.equals("2")) {
                    return new Validation(false, "棋盘包含无法识别的棋子");
                }
            }
        }
        return new Validation(true, "局面有效");
    }

    public static Position editPosition(Position position, int index, String piece) {
        if (position == null || index < 0 || index >= position.board.length) return position;
        String selected = piece == null ? "" : piece;
        String[] board = position.board.clone();
        board[index] = selected.equals(board[index]) ? "" : selected;
        return new Position(position.game, position.size, board, position.currentPlayer);
    }

    public static Position standardPosition(String game, int size) {
        String normalized = normalizeGame(game);
        if (!"xiangqi".equals(normalized)) {
            int boardSize = size > 0 ? size : "go".equals(normalized) ? 19 : 15;
            return new Position(normalized, boardSize, emptyBoard(boardSize * boardSize), 1);
        }
        String[] board = emptyBoard(90);
        String[] blackBack = {"bR", "bN", "bB", "bA", "bK", "bA", "bB", "bN", "bR"};
        String[] redBack = {"rR", "rN", "rB", "rA", "rK", "rA", "rB", "rN", "rR"};
        for (int column = 0; column < 9; column++) {
            board[column] = blackBack[column];
            board[81 + column] = redBack[column];
        }
        board[19] = "bC"; board[25] = "bC"; board[64] = "rC"; board[70] = "rC";
        for (int index : new int[]{27, 29, 31, 33, 35}) board[index] = "bP";
        for (int index : new int[]{54, 56, 58, 60, 62}) board[index] = "rP";
        return new Position("xiangqi", 0, board, 1);
    }

    public static List<Move> legalMoves(Position position) {
        if (!validateEditor(position).ok) return Collections.emptyList();
        if (position.game.equals("xiangqi")) return legalXiangqiMoves(position);
        List<Move> candidates = candidateMoves(position);
        if (position.game.equals("go")) {
            List<Move> legal = new ArrayList<>();
            for (Move move : candidates) if (applyGoMove(position, move).ok) legal.add(move);
            return legal;
        }
        return candidates;
    }

    public static ApplyResult applyMove(Position position, Move move) {
        Validation validation = validateEditor(position);
        if (!validation.ok) return failure(validation.message, position);
        if (position.game.equals("go")) return applyGoMove(position, move);
        if (position.game.equals("xiangqi")) {
            Move legal = null;
            for (Move item : legalXiangqiMoves(position)) {
                if (item.from == move.from && item.to == move.to) {
                    legal = item;
                    break;
                }
            }
            if (legal == null) return failure("这一步不符合象棋规则", position);
            String[] board = position.board.clone();
            board[legal.to] = board[legal.from];
            board[legal.from] = "";
            return success(nextPosition(position, board), Collections.emptyList());
        }
        if (move == null || move.index < 0 || move.index >= position.board.length || !position.board[move.index].isEmpty()) {
            return failure("该位置不能落子", position);
        }
        String[] board = position.board.clone();
        board[move.index] = String.valueOf(position.currentPlayer);
        return success(nextPosition(position, board), Collections.emptyList());
    }

    public static Analysis analyze(Position position, Difficulty difficulty) {
        Validation validation = validateEditor(position);
        if (!validation.ok) {
            return new Analysis(false, 0, Collections.emptyList(), null, validation.message, 0,
                    0, "无效局面", Collections.emptyList());
        }
        Difficulty level = difficulty == null ? Difficulty.STANDARD : difficulty;
        List<Move> legal = legalMoves(position);
        legal.sort((left, right) -> {
            int scoreOrder = Integer.compare(immediateScore(position, right), immediateScore(position, left));
            return scoreOrder != 0 ? scoreOrder : Integer.compare(moveKey(left), moveKey(right));
        });
        int limit = Math.min(legal.size(), level.candidateLimit);
        List<Move> scored = new ArrayList<>();
        int nodes = 0;
        for (int i = 0; i < limit; i++) {
            Move move = legal.get(i);
            int score = immediateScore(position, move);
            nodes++;
            ApplyResult applied = applyMove(position, move);
            if (applied.ok && level.replyDepth > 1 && !isImmediateWin(position, move)) {
                List<Move> replies = legalMoves(applied.position);
                replies.sort(Comparator.comparingInt(BoardAnalysis::moveKey));
                int replyLimit = Math.min(replies.size(), level == Difficulty.CHALLENGE ? 18 : 6);
                int replyBest = Integer.MIN_VALUE;
                for (int replyIndex = 0; replyIndex < replyLimit; replyIndex++) {
                    replyBest = Math.max(replyBest, immediateScore(applied.position, replies.get(replyIndex)));
                    nodes++;
                }
                if (replyBest != Integer.MIN_VALUE) score -= replyBest * 3 / 4;
            }
            if (applied.ok && level == Difficulty.CHALLENGE && !isImmediateWin(position, move)) {
                int continuations = Math.min(10, legalMoves(applied.position).size());
                nodes += continuations;
            }
            move.score = score;
            scored.add(move);
        }
        scored.sort((left, right) -> {
            int scoreOrder = Integer.compare(right.score, left.score);
            return scoreOrder != 0 ? scoreOrder : Integer.compare(moveKey(left), moveKey(right));
        });
        List<Move> top = new ArrayList<>(scored.subList(0, Math.min(5, scored.size())));
        Move recommended = top.isEmpty() ? null : top.get(0);
        String gameName = position.game.equals("gobang") ? "五子棋" : position.game.equals("go") ? "围棋" : "象棋";
        String tactical = tacticalLabel(position, recommended);
        String explanation = recommended == null ? "当前没有合法走法。" :
                tactical + "：" + gameName + "离线分析已比较 " + nodes + " 个搜索节点。";
        double confidence = confidence(top);
        List<Move> principalVariation = new ArrayList<>();
        if (recommended != null) {
            principalVariation.add(recommended);
            ApplyResult applied = applyMove(position, recommended);
            if (applied.ok && !"立即获胜".equals(tactical) && level != Difficulty.EASY) {
                List<Move> replies = legalMoves(applied.position);
                replies.sort((left, right) -> Integer.compare(immediateScore(applied.position, right), immediateScore(applied.position, left)));
                if (!replies.isEmpty()) principalVariation.add(replies.get(0));
            }
        }
        return new Analysis(true, recommended == null ? 0 : recommended.score, top, recommended,
                explanation, nodes, confidence, tactical, principalVariation);
    }

    public static Move bestMove(Position position, Difficulty difficulty) {
        return analyze(position, difficulty).recommended;
    }

    public static List<Puzzle> builtInPuzzles(String game) {
        String normalized = normalizeGame(game);
        List<Puzzle> puzzles = new ArrayList<>();
        if (normalized.equals("gobang")) {
            String[] first = emptyBoard(225);
            for (int col = 3; col <= 6; col++) first[7 * 15 + col] = "1";
            puzzles.add(new Puzzle("gobang-001", new Position("gobang", 15, first, 1),
                    "一击成五", "黑先，一手完成五连", "入门",
                    Arrays.asList(new Move(7 * 15 + 2), new Move(7 * 15 + 7))));

            String[] second = emptyBoard(225);
            for (int col = 4; col <= 7; col++) second[5 * 15 + col] = "2";
            puzzles.add(new Puzzle("gobang-002", new Position("gobang", 15, second, 1),
                    "封住冲四", "黑先，挡住白棋下一手取胜", "进阶",
                    Arrays.asList(new Move(5 * 15 + 3), new Move(5 * 15 + 8))));

            String[] third = emptyBoard(225);
            for (int point = 4; point <= 7; point++) third[point * 15 + point] = "1";
            puzzles.add(new Puzzle("gobang-003", new Position("gobang", 15, third, 1),
                    "斜线终结", "黑先，补成斜线五连", "进阶",
                    Arrays.asList(new Move(3 * 15 + 3), new Move(8 * 15 + 8))));
            return puzzles;
        }
        if (normalized.equals("go")) {
            puzzles.add(goPuzzle("go-001", "中央提子", 6, new int[]{1, 5, 7}, 11, "入门"));
            puzzles.add(goPuzzle("go-002", "边上收气", 8, new int[]{3, 7, 9}, 13, "进阶"));
            puzzles.add(goPuzzle("go-003", "下边提子", 18, new int[]{13, 17, 19}, 23, "进阶"));
            return puzzles;
        }
        if (normalized.equals("xiangqi")) {
            puzzles.add(xiangqiPuzzle("xiangqi-001", "车取黑将", "红先，找到立即取胜着", 1,
                    new int[]{4, 85, 13}, new String[]{"bK", "rK", "rR"}, new Move(13, 4), "入门"));
            puzzles.add(xiangqiPuzzle("xiangqi-002", "黑车绝杀", "黑先，直接擒帅", 2,
                    new int[]{4, 85, 76}, new String[]{"bK", "rK", "bR"}, new Move(76, 85), "进阶"));
            puzzles.add(xiangqiPuzzle("xiangqi-003", "隔山打将", "红先，炮借士架擒将", 1,
                    new int[]{4, 13, 22, 85}, new String[]{"bK", "bA", "rC", "rK"}, new Move(22, 4), "进阶"));
            return puzzles;
        }
        return puzzles;
    }

    public static Puzzle builtInPuzzle(String game, int level) {
        List<Puzzle> puzzles = builtInPuzzles(game);
        if (puzzles.isEmpty()) return null;
        return puzzles.get(Math.floorMod(level, puzzles.size()));
    }

    private static Puzzle goPuzzle(String id, String title, int white, int[] black, int answer, String difficulty) {
        String[] board = emptyBoard(25);
        board[white] = "2";
        for (int point : black) board[point] = "1";
        return new Puzzle(id, new Position("go", 5, board, 1), title,
                "黑先，找到白棋最后一口气", difficulty, Collections.singletonList(new Move(answer)));
    }

    private static Puzzle xiangqiPuzzle(String id, String title, String goal, int player,
                                        int[] positions, String[] pieces, Move answer, String difficulty) {
        String[] board = emptyBoard(90);
        for (int index = 0; index < positions.length; index++) board[positions[index]] = pieces[index];
        return new Puzzle(id, new Position("xiangqi", 0, board, player), title, goal,
                difficulty, Collections.singletonList(answer));
    }

    public static PuzzleResult evaluatePuzzle(Puzzle puzzle, Move move) {
        if (puzzle == null || move == null) return new PuzzleResult(false, false, "残局数据无效", null);
        ApplyResult applied = applyMove(puzzle.position, move);
        if (!applied.ok) return new PuzzleResult(false, false, applied.reason, puzzle.position);
        boolean solved = false;
        for (Move answer : puzzle.solution) if (sameMove(move, answer)) solved = true;
        return new PuzzleResult(true, solved, solved ? "解答正确" : "这步合法，但不是关键着，再想一想。", applied.position);
    }

    public static boolean sameMove(Move left, Move right) {
        if (left == null || right == null) return false;
        return left.index >= 0 || right.index >= 0
                ? left.index == right.index
                : left.from == right.from && left.to == right.to;
    }

    private static String tacticalLabel(Position position, Move move) {
        if (move == null) return "无合法着";
        if (isImmediateWin(position, move)) return "立即获胜";
        ApplyResult applied = applyMove(position, move);
        if (position.game.equals("go") && applied.ok && !applied.captures.isEmpty()) return "提子 " + applied.captures.size();
        if (position.game.equals("xiangqi") && !move.capture.isEmpty()) return "优先吃子";
        if (position.game.equals("gobang") && immediateScore(position, move) >= 900_000) return "必须防守";
        return "均衡";
    }

    private static double confidence(List<Move> candidates) {
        if (candidates.isEmpty()) return 0;
        int gap = candidates.size() > 1 ? Math.max(0, candidates.get(0).score - candidates.get(1).score) : Math.abs(candidates.get(0).score);
        return Math.max(0.5, Math.min(0.99, 0.58 + Math.log10(gap + 1) * 0.08));
    }

    public static RoomInvite parseRoomInvite(String raw, long nowMillis) {
        InviteResult result = tryParseRoomInvite(raw, nowMillis);
        if (!result.ok) throw new IllegalArgumentException(result.reason);
        return result.invite;
    }

    public static InviteResult tryParseRoomInvite(String raw, long nowMillis) {
        try {
            URI uri = URI.create(raw == null ? "" : raw.trim());
            if (!"zhengzhengboardgames".equalsIgnoreCase(uri.getScheme()) || !"join".equalsIgnoreCase(uri.getHost())) {
                return new InviteResult(false, "不是铮铮桌游邀请", null);
            }
            Map<String, String> query = queryMap(uri.getRawQuery());
            int version = Integer.parseInt(query.getOrDefault("v", "1"));
            String purpose = query.getOrDefault("purpose", "continue").toLowerCase(Locale.ROOT);
            String game = safeValue(normalizeGame(query.get("game")), 40).toLowerCase(Locale.ROOT);
            String room = safeValue(query.get("room"), 24);
            String token = safeValue(query.containsKey("invite") ? query.get("invite") : query.get("token"), 160);
            long expiresAt = Long.parseLong(query.containsKey("expires") ? query.get("expires") : query.getOrDefault("expiresAt", "0"));
            if (version != PROTOCOL_VERSION) return new InviteResult(false, "邀请协议版本不受支持", null);
            if (!purpose.equals("continue") && !purpose.equals("challenge")) {
                return new InviteResult(false, "邀请用途不受支持", null);
            }
            if (game.isEmpty()) return new InviteResult(false, "邀请缺少棋种", null);
            if (room.length() < 4 || token.length() < 3) return new InviteResult(false, "邀请内容不完整", null);
            if (expiresAt <= nowMillis) return new InviteResult(false, "邀请已过期", null);
            return new InviteResult(true, "", new RoomInvite(version, purpose, game, room, token, expiresAt));
        } catch (Exception error) {
            return new InviteResult(false, "邀请格式不正确", null);
        }
    }

    private static ApplyResult applyGoMove(Position position, Move move) {
        if (move == null || move.index < 0 || move.index >= position.board.length || !position.board[move.index].isEmpty()) {
            return failure("该位置不能落子", position);
        }
        String[] board = position.board.clone();
        String player = String.valueOf(position.currentPlayer);
        String opponent = position.currentPlayer == 1 ? "2" : "1";
        board[move.index] = player;
        List<Integer> captures = new ArrayList<>();
        for (int next : neighbors(move.index, position.size)) {
            if (!board[next].equals(opponent)) continue;
            Set<Integer> group = groupAt(board, position.size, next);
            if (liberties(board, position.size, group).isEmpty()) {
                for (int stone : group) {
                    board[stone] = "";
                    captures.add(stone);
                }
            }
        }
        if (liberties(board, position.size, groupAt(board, position.size, move.index)).isEmpty()) {
            return failure("禁入点：落子后没有气", position);
        }
        if (position.history.size() > 1) {
            String[] previous = position.history.get(position.history.size() - 2);
            if (Arrays.equals(previous, board)) return failure("劫争：不能立即还原上一局面", position);
        }
        Collections.sort(captures);
        return success(nextPosition(position, board), captures);
    }

    private static List<Move> candidateMoves(Position position) {
        Set<Integer> occupied = new HashSet<>();
        for (int index = 0; index < position.board.length; index++) if (!position.board[index].isEmpty()) occupied.add(index);
        if (occupied.isEmpty()) {
            int center = position.size / 2;
            return new ArrayList<>(Collections.singletonList(new Move(center * position.size + center)));
        }
        Set<Integer> candidates = new HashSet<>();
        for (int index : occupied) {
            int row = index / position.size;
            int column = index % position.size;
            for (int dr = -2; dr <= 2; dr++) {
                for (int dc = -2; dc <= 2; dc++) {
                    int r = row + dr;
                    int c = column + dc;
                    int next = r * position.size + c;
                    if (inside(r, c, position.size, position.size) && position.board[next].isEmpty()) candidates.add(next);
                }
            }
        }
        List<Integer> ordered = new ArrayList<>(candidates);
        Collections.sort(ordered);
        List<Move> result = new ArrayList<>();
        for (int index : ordered) result.add(new Move(index));
        return result;
    }

    private static int immediateScore(Position position, Move move) {
        if (position.game.equals("gobang")) return gomokuScore(position, move);
        if (position.game.equals("go")) return goScore(position, move);
        int capture = move.capture.isEmpty() ? 0 : XIANGQI_VALUES.getOrDefault(move.capture.charAt(1), 0);
        ApplyResult applied = applyMove(position, move);
        int check = applied.ok && isXiangqiChecked(applied.position.board, applied.position.currentPlayer) ? 80 : 0;
        int row = move.to / 9;
        int column = move.to % 9;
        return capture + check + 4 - Math.abs(column - 4) + (position.currentPlayer == 1 ? 9 - row : row);
    }

    private static int gomokuScore(Position position, Move move) {
        String[] board = position.board.clone();
        String player = String.valueOf(position.currentPlayer);
        String opponent = position.currentPlayer == 1 ? "2" : "1";
        board[move.index] = player;
        int score = lineScore(board, position.size, move.index, player, 10);
        board[move.index] = opponent;
        score += lineScore(board, position.size, move.index, opponent, 8);
        int center = position.size / 2;
        return score - Math.abs(move.index / position.size - center) - Math.abs(move.index % position.size - center);
    }

    private static int lineScore(String[] board, int size, int index, String player, int weight) {
        int score = 0;
        for (int[] direction : new int[][]{{1, 0}, {0, 1}, {1, 1}, {1, -1}}) {
            int line = lineCount(board, size, index, player, direction[0], direction[1]);
            score += line >= 5 ? 1_000_000 : (int) Math.pow(line, 4) * weight;
        }
        return score;
    }

    private static int goScore(Position position, Move move) {
        ApplyResult result = applyGoMove(position, move);
        if (!result.ok) return Integer.MIN_VALUE;
        Set<Integer> group = groupAt(result.position.board, position.size, move.index);
        int center = position.size / 2;
        int distance = Math.abs(move.index / position.size - center) + Math.abs(move.index % position.size - center);
        return result.captures.size() * 200 + liberties(result.position.board, position.size, group).size() * 12 - distance;
    }

    private static boolean isImmediateWin(Position position, Move move) {
        if (!position.game.equals("gobang")) return false;
        String[] board = position.board.clone();
        String player = String.valueOf(position.currentPlayer);
        board[move.index] = player;
        for (int[] direction : new int[][]{{1, 0}, {0, 1}, {1, 1}, {1, -1}}) {
            if (lineCount(board, position.size, move.index, player, direction[0], direction[1]) >= 5) return true;
        }
        return false;
    }

    private static List<Move> legalXiangqiMoves(Position position) {
        List<Move> legal = new ArrayList<>();
        for (Move move : rawXiangqiMoves(position.board, position.currentPlayer)) {
            String[] board = position.board.clone();
            board[move.to] = board[move.from];
            board[move.from] = "";
            if (!isXiangqiChecked(board, position.currentPlayer)) legal.add(move);
        }
        return legal;
    }

    private static List<Move> rawXiangqiMoves(String[] board, int side) {
        List<Move> moves = new ArrayList<>();
        for (int from = 0; from < 90; from++) {
            String piece = board[from];
            if (pieceSide(piece) != side) continue;
            char type = Character.toUpperCase(piece.charAt(1));
            int row = from / 9;
            int column = from % 9;
            if (type == 'R' || type == 'C') addSlidingMoves(board, moves, from, row, column, side, type);
            else if (type == 'N') addHorseMoves(board, moves, from, row, column, side);
            else if (type == 'B') addElephantMoves(board, moves, from, row, column, side);
            else if (type == 'A') addAdvisorMoves(board, moves, from, row, column, side);
            else if (type == 'K') addKingMoves(board, moves, from, row, column, side);
            else if (type == 'P') addPawnMoves(board, moves, from, row, column, side);
        }
        return moves;
    }

    private static void addSlidingMoves(String[] board, List<Move> moves, int from, int row, int column, int side, char type) {
        for (int[] direction : new int[][]{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}) {
            int r = row + direction[0];
            int c = column + direction[1];
            boolean screen = false;
            while (inside(r, c, 10, 9)) {
                int to = r * 9 + c;
                if (type == 'R') {
                    if (board[to].isEmpty()) moves.add(new Move(from, to));
                    else {
                        if (pieceSide(board[to]) != side) moves.add(new Move(from, to).withCapture(board[to]));
                        break;
                    }
                } else if (!screen) {
                    if (board[to].isEmpty()) moves.add(new Move(from, to));
                    else screen = true;
                } else if (!board[to].isEmpty()) {
                    if (pieceSide(board[to]) != side) moves.add(new Move(from, to).withCapture(board[to]));
                    break;
                }
                r += direction[0];
                c += direction[1];
            }
        }
    }

    private static void addHorseMoves(String[] board, List<Move> moves, int from, int row, int column, int side) {
        int[][] patterns = {{-2,-1,-1,0},{-2,1,-1,0},{2,-1,1,0},{2,1,1,0},
                {-1,-2,0,-1},{1,-2,0,-1},{-1,2,0,1},{1,2,0,1}};
        for (int[] pattern : patterns) {
            int legRow = row + pattern[2];
            int legColumn = column + pattern[3];
            if (inside(legRow, legColumn, 10, 9) && board[legRow * 9 + legColumn].isEmpty()) {
                addStep(board, moves, from, row + pattern[0], column + pattern[1], side);
            }
        }
    }

    private static void addElephantMoves(String[] board, List<Move> moves, int from, int row, int column, int side) {
        for (int[] direction : new int[][]{{-2,-2},{-2,2},{2,-2},{2,2}}) {
            int r = row + direction[0];
            int c = column + direction[1];
            boolean ownHalf = side == 1 ? r >= 5 : r <= 4;
            if (ownHalf && inside(r, c, 10, 9) && board[(row + direction[0] / 2) * 9 + column + direction[1] / 2].isEmpty()) {
                addStep(board, moves, from, r, c, side);
            }
        }
    }

    private static void addAdvisorMoves(String[] board, List<Move> moves, int from, int row, int column, int side) {
        for (int[] direction : new int[][]{{-1,-1},{-1,1},{1,-1},{1,1}}) {
            int r = row + direction[0];
            int c = column + direction[1];
            if (inPalace(r, c, side)) addStep(board, moves, from, r, c, side);
        }
    }

    private static void addKingMoves(String[] board, List<Move> moves, int from, int row, int column, int side) {
        for (int[] direction : new int[][]{{-1,0},{1,0},{0,-1},{0,1}}) {
            int r = row + direction[0];
            int c = column + direction[1];
            if (inPalace(r, c, side)) addStep(board, moves, from, r, c, side);
        }
        int r = row + (side == 1 ? -1 : 1);
        while (inside(r, column, 10, 9)) {
            int to = r * 9 + column;
            if (!board[to].isEmpty()) {
                if (board[to].equals(side == 1 ? "bK" : "rK")) moves.add(new Move(from, to).withCapture(board[to]));
                break;
            }
            r += side == 1 ? -1 : 1;
        }
    }

    private static void addPawnMoves(String[] board, List<Move> moves, int from, int row, int column, int side) {
        int forward = side == 1 ? -1 : 1;
        addStep(board, moves, from, row + forward, column, side);
        boolean crossed = side == 1 ? row <= 4 : row >= 5;
        if (crossed) {
            addStep(board, moves, from, row, column - 1, side);
            addStep(board, moves, from, row, column + 1, side);
        }
    }

    private static void addStep(String[] board, List<Move> moves, int from, int row, int column, int side) {
        if (!inside(row, column, 10, 9)) return;
        int to = row * 9 + column;
        if (pieceSide(board[to]) != side) moves.add(new Move(from, to).withCapture(board[to]));
    }

    private static boolean isXiangqiChecked(String[] board, int side) {
        int king = indexOf(board, side == 1 ? "rK" : "bK");
        if (king < 0 || kingsFacing(board)) return true;
        for (Move move : rawXiangqiMoves(board, side == 1 ? 2 : 1)) if (move.to == king) return true;
        return false;
    }

    private static boolean kingsFacing(String[] board) {
        int red = indexOf(board, "rK");
        int black = indexOf(board, "bK");
        if (red < 0 || black < 0 || red % 9 != black % 9) return false;
        int column = red % 9;
        int start = Math.min(red / 9, black / 9) + 1;
        int end = Math.max(red / 9, black / 9);
        for (int row = start; row < end; row++) if (!board[row * 9 + column].isEmpty()) return false;
        return true;
    }

    private static Set<Integer> groupAt(String[] board, int size, int start) {
        String color = board[start];
        if (color.isEmpty()) return Collections.emptySet();
        Set<Integer> seen = new HashSet<>();
        ArrayDeque<Integer> queue = new ArrayDeque<>();
        queue.add(start);
        while (!queue.isEmpty()) {
            int current = queue.removeLast();
            if (!seen.add(current)) continue;
            for (int next : neighbors(current, size)) if (board[next].equals(color) && !seen.contains(next)) queue.add(next);
        }
        return seen;
    }

    private static Set<Integer> liberties(String[] board, int size, Set<Integer> group) {
        Set<Integer> result = new HashSet<>();
        for (int index : group) for (int next : neighbors(index, size)) if (board[next].isEmpty()) result.add(next);
        return result;
    }

    private static List<Integer> neighbors(int index, int size) {
        List<Integer> result = new ArrayList<>(4);
        int row = index / size;
        int column = index % size;
        if (row > 0) result.add(index - size);
        if (row + 1 < size) result.add(index + size);
        if (column > 0) result.add(index - 1);
        if (column + 1 < size) result.add(index + 1);
        return result;
    }

    private static int lineCount(String[] board, int size, int index, String player, int dr, int dc) {
        int row = index / size;
        int column = index % size;
        int total = 1;
        for (int direction : new int[]{-1, 1}) {
            int r = row + dr * direction;
            int c = column + dc * direction;
            while (inside(r, c, size, size) && board[r * size + c].equals(player)) {
                total++;
                r += dr * direction;
                c += dc * direction;
            }
        }
        return total;
    }

    private static Position nextPosition(Position position, String[] board) {
        List<String[]> history = new ArrayList<>(position.history);
        history.add(position.board.clone());
        return new Position(position.game, position.size, board, position.currentPlayer == 1 ? 2 : 1, history);
    }

    private static ApplyResult success(Position position, List<Integer> captures) {
        return new ApplyResult(true, "", position, captures);
    }

    private static ApplyResult failure(String reason, Position position) {
        return new ApplyResult(false, reason, position, Collections.emptyList());
    }

    private static String normalizeGame(String game) {
        String value = game == null ? "" : game.trim().toLowerCase(Locale.ROOT);
        if (value.equals("native-gobang")) return "gobang";
        if (value.equals("chinese-chess") || value.equals("chess")) return "xiangqi";
        return value;
    }

    private static String[] normalizedBoard(String[] source, int expected) {
        String[] result = emptyBoard(expected);
        if (source == null) return result;
        for (int index = 0; index < Math.min(source.length, expected); index++) {
            result[index] = source[index] == null ? "" : source[index];
        }
        return result;
    }

    private static String[] emptyBoard(int size) {
        String[] result = new String[size];
        Arrays.fill(result, "");
        return result;
    }

    private static int count(String[] board, String value) {
        int total = 0;
        for (String cell : board) if (cell.equals(value)) total++;
        return total;
    }

    private static int indexOf(String[] board, String value) {
        for (int index = 0; index < board.length; index++) if (board[index].equals(value)) return index;
        return -1;
    }

    private static int pieceSide(String piece) {
        if (piece == null || piece.isEmpty()) return 0;
        return piece.charAt(0) == 'r' ? 1 : piece.charAt(0) == 'b' ? 2 : 0;
    }

    private static boolean inside(int row, int column, int rows, int columns) {
        return row >= 0 && row < rows && column >= 0 && column < columns;
    }

    private static boolean inPalace(int row, int column, int side) {
        return column >= 3 && column <= 5 && (side == 1 ? row >= 7 && row <= 9 : row >= 0 && row <= 2);
    }

    private static int moveKey(Move move) {
        return move.index >= 0 ? move.index : move.from * 100 + move.to;
    }

    private static Map<String, String> queryMap(String rawQuery) {
        Map<String, String> result = new HashMap<>();
        if (rawQuery == null || rawQuery.isEmpty()) return result;
        for (String pair : rawQuery.split("&")) {
            int split = pair.indexOf('=');
            String key = split < 0 ? pair : pair.substring(0, split);
            String value = split < 0 ? "" : pair.substring(split + 1);
            result.put(URLDecoder.decode(key, StandardCharsets.UTF_8), URLDecoder.decode(value, StandardCharsets.UTF_8));
        }
        return result;
    }

    private static String safeValue(String value, int maxLength) {
        if (value == null) return "";
        String cleaned = value.replaceAll("[^A-Za-z0-9_-]", "");
        return cleaned.substring(0, Math.min(maxLength, cleaned.length()));
    }
}
