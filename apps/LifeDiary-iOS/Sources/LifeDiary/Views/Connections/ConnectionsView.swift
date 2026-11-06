import SwiftUI
import LifeDiaryCore

struct ConnectionsView: View {
    @ObservedObject var repository: LifeAppState

    var body: some View {
        Group {
            if let publisher = repository.communityPublisher {
                CommunityFeedView(client: repository.onlineClient, publisher: publisher)
            } else {
                LifeEmptyState(
                    symbol: "exclamationmark.triangle",
                    title: "无法读取发布队列",
                    message: "为避免覆盖待发布内容，当前保持只读。"
                )
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu("联系") {
                    NavigationLink("好友") {
                        PassportDestination(passport: repository.passport, title: "好友", symbol: "person.2") {
                            FriendsView(client: repository.onlineClient, accountID: repository.passport.accountID ?? "")
                        }
                    }
                    NavigationLink("聊天") {
                        PassportDestination(passport: repository.passport, title: "聊天", symbol: "bubble.left.and.bubble.right") {
                            ChatListView(client: repository.onlineClient, accountID: repository.passport.accountID ?? "")
                        }
                    }
                }
            }
        }
    }
}

private struct PassportDestination<Destination: View>: View {
    @ObservedObject var passport: PassportSession
    let title: String
    let symbol: String
    @ViewBuilder let destination: () -> Destination

    var body: some View {
        if passport.accountID != nil {
            NavigationLink(destination: destination) {
                ConnectionDestinationRow(symbol: symbol, title: title, detail: "已连接铮铮通行证")
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                if passport.authorizationStatus == .authorizing {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("正在等待系统认证，以使用\(title)")
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("正在等待铮铮通行证系统认证")
                    Button("取消登录", role: .cancel) {
                        passport.cancelAuthorization()
                    }
                    .accessibilityHint("停止当前系统认证会话")
                } else {
                    Button {
                        passport.beginAuthorization()
                    } label: {
                        ConnectionDestinationRow(
                            symbol: "person.badge.key",
                            title: "登录后使用\(title)",
                            detail: "通过系统认证会话登录"
                        )
                    }
                    .accessibilityHint("打开铮铮通行证系统认证会话")
                }
                if let error = passport.authorizationError {
                    Label(passportErrorText(error), systemImage: "exclamationmark.circle")
                        .font(.footnote)
                        .foregroundColor(error == .cancelled ? Color.secondary : Color.red)
                        .accessibilityLabel("通行证状态：\(passportErrorText(error))")
                    if passport.authorizationStatus != .authorizing {
                        Button("重新登录") { passport.beginAuthorization() }
                            .buttonStyle(.bordered)
                            .accessibilityHint("重新打开铮铮通行证系统认证会话")
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func passportErrorText(_ error: PassportAuthorizationError) -> String {
        switch error {
        case .invalidCallback: return "登录回调验证失败。"
        case .unavailable: return "系统认证会话未能启动。"
        case .cancelled: return "已取消登录。"
        case .exchangeFailed: return "通行证暂时无法完成登录。"
        }
    }
}

private struct ConnectionDestinationRow: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: symbol).foregroundStyle(LifeTheme.moss)
        }
        .padding(.vertical, 5)
    }
}

private struct CommunityFeedView: View {
    let client: LifeOnlineClient
    @ObservedObject var publisher: CommunityPublisher
    @State private var posts: [RemoteCommunityPost] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            if !publisher.publications.isEmpty {
                Section("我的发布状态") {
                    ForEach(publisher.publications) { publication in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(publication.payload.topic.isEmpty ? "无标题" : publication.payload.topic)
                                .font(.headline)
                            Label(statusText(publication.state), systemImage: statusSymbol(publication.state))
                                .font(.subheadline)
                                .foregroundStyle(publication.state == .failed ? .red : .secondary)
                            if let detail = publication.lastError, publication.state == .failed {
                                Text(detail).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    if publisher.publications.contains(where: { $0.state != .published }) {
                        Button {
                            Task {
                                do {
                                    try await publisher.retryPending()
                                    await load()
                                } catch {
                                    errorMessage = error.localizedDescription
                                }
                            }
                        } label: {
                            if publisher.isWorking {
                                Label("正在重试", systemImage: "arrow.triangle.2.circlepath")
                            } else {
                                Label("重试未完成的发布", systemImage: "arrow.clockwise")
                            }
                        }
                        .disabled(publisher.isWorking)
                    }
                }
            }

            Section("公共日记") {
                if isLoading && posts.isEmpty {
                    HStack { ProgressView(); Text("正在载入公共日记") }
                } else if let errorMessage, posts.isEmpty {
                    VStack(spacing: 10) {
                        Label("无法载入公共日记", systemImage: "wifi.exclamationmark")
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Button("重试") { Task { await load() } }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                } else if posts.isEmpty {
                    Text("公共日记还没有内容。你可以从个人日记创建一份公开副本。").foregroundStyle(.secondary)
                } else {
                    ForEach(posts) { post in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(post.topic.isEmpty ? "无标题" : post.topic).font(.headline)
                            Text(post.body)
                            HStack {
                                Text(post.author.nickname)
                                Spacer()
                                Label("\(post.likeCount)", systemImage: "heart")
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 5)
                    }
                }
            }
        }
        .lifePaperBackground()
        .navigationTitle("公共日记")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        do {
            posts = try await client.listCommunityPosts()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func statusText(_ state: CommunityPublicationState) -> String {
        switch state {
        case .queued: return "已在本机排队，尚未发布"
        case .failed: return "发布失败，等待重试"
        case .published: return "服务器已确认发布"
        }
    }

    private func statusSymbol(_ state: CommunityPublicationState) -> String {
        switch state {
        case .queued: return "clock"
        case .failed: return "exclamationmark.circle"
        case .published: return "checkmark.circle"
        }
    }
}

private struct FriendsView: View {
    let client: LifeOnlineClient
    let accountID: String
    @State private var overview: FriendsOverview?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var actionMessage: String?

    var body: some View {
        List {
            Section("好友") {
                if isLoading && overview == nil {
                    HStack { ProgressView(); Text("正在载入好友") }
                } else if let friends = overview?.friends, friends.isEmpty {
                    Text("目前没有好友。").foregroundStyle(.secondary)
                } else {
                    ForEach(overview?.friends ?? []) { friend in
                        Label(friend.uid, systemImage: "person.crop.circle")
                    }
                }
            }

            if let requests = overview?.requests.filter({
                $0.status == "pending" && $0.toUid == accountID
            }), !requests.isEmpty {
                Section("待处理申请") {
                    ForEach(requests) { request in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(request.fromUid)
                            HStack {
                                Button("接受") { respond(request, action: "accept") }
                                    .buttonStyle(.borderedProminent)
                                Button("拒绝", role: .destructive) { respond(request, action: "reject") }
                                    .buttonStyle(.bordered)
                            }
                        }
                    }
                }
            }

            Section("添加好友") {
                NavigationLink {
                    FriendSearchView(client: client)
                } label: {
                    Label("按昵称查找", systemImage: "magnifyingglass")
                }
                NavigationLink {
                    TapFriendView(client: client)
                } label: {
                    Label("碰一碰令牌", systemImage: "hand.tap")
                }
            }

            if let errorMessage {
                Section { Label(errorMessage, systemImage: "exclamationmark.circle").foregroundStyle(.red) }
            }
            if let actionMessage {
                Section { Label(actionMessage, systemImage: "checkmark.circle").foregroundStyle(.secondary) }
            }
        }
        .lifePaperBackground()
        .navigationTitle("好友")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do { overview = try await client.listFriends() }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    private func respond(_ request: FriendRequestRecord, action: String) {
        Task {
            do {
                _ = try await client.respondToRequest(id: request.id, action: action)
                actionMessage = action == "accept" ? "已接受申请。" : "已拒绝申请。"
                await load()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

private struct FriendSearchView: View {
    let client: LifeOnlineClient
    @State private var query = ""
    @State private var users: [FriendUser] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var requested: Set<String> = []

    var body: some View {
        List {
            Section {
                TextField("至少输入两个字", text: $query)
                    .textInputAutocapitalization(.never)
                Button {
                    Task { await search() }
                } label: {
                    if isLoading { HStack { ProgressView(); Text("搜索中") } }
                    else { Label("搜索", systemImage: "magnifyingglass") }
                }
                .disabled(isLoading || query.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
            }
            Section("结果") {
                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.circle").foregroundStyle(.red)
                } else if users.isEmpty {
                    Text(query.isEmpty ? "输入昵称后开始搜索。" : "没有匹配的通行证用户。")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(users) { user in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(user.nickname)
                                Text(user.uid).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button(requested.contains(user.uid) ? "已申请" : "添加") {
                                request(user)
                            }
                            .buttonStyle(.bordered)
                            .disabled(requested.contains(user.uid))
                        }
                    }
                }
            }
        }
        .lifePaperBackground()
        .navigationTitle("查找好友")
    }

    private func search() async {
        isLoading = true
        errorMessage = nil
        do { users = try await client.searchFriends(query: query.trimmingCharacters(in: .whitespacesAndNewlines)) }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    private func request(_ user: FriendUser) {
        Task {
            do {
                _ = try await client.requestFriend(uid: user.uid)
                requested.insert(user.uid)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

private struct TapFriendView: View {
    let client: LifeOnlineClient
    @State private var issued: TapToken?
    @State private var input = ""
    @State private var isWorking = false
    @State private var message: String?
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section("让对方添加我") {
                Button {
                    Task { await issue() }
                } label: {
                    if isWorking { HStack { ProgressView(); Text("正在生成") } }
                    else { Label("生成一次性令牌", systemImage: "hand.tap") }
                }
                .disabled(isWorking)
                if let issued {
                    Text(issued.token).font(.footnote.monospaced()).textSelection(.enabled)
                    ShareLink(item: issued.token) {
                        Label("通过系统分享令牌", systemImage: "square.and.arrow.up")
                    }
                    Text("令牌将在 \(issued.expiresAt) 失效，且只能使用一次。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            Section("使用对方的令牌") {
                TextField("粘贴一次性令牌", text: $input)
                    .textInputAutocapitalization(.never)
                Button("发送碰一碰好友申请") {
                    Task { await consume() }
                }
                .disabled(isWorking || input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Text("使用令牌只会创建待确认申请，不会直接成为好友。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if let message { Section { Label(message, systemImage: "checkmark.circle") } }
            if let errorMessage { Section { Label(errorMessage, systemImage: "exclamationmark.circle").foregroundStyle(.red) } }
        }
        .lifePaperBackground()
        .navigationTitle("碰一碰令牌")
    }

    private func issue() async {
        isWorking = true
        errorMessage = nil
        do { issued = try await client.issueTapToken() }
        catch { errorMessage = error.localizedDescription }
        isWorking = false
    }

    private func consume() async {
        isWorking = true
        errorMessage = nil
        do {
            _ = try await client.consumeTapToken(input.trimmingCharacters(in: .whitespacesAndNewlines))
            message = "好友申请已由服务器创建，等待对方确认。"
            input = ""
        } catch {
            errorMessage = error.localizedDescription
        }
        isWorking = false
    }
}

private struct ChatListView: View {
    let client: LifeOnlineClient
    let accountID: String
    @State private var overview: FriendsOverview?
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            if isLoading {
                HStack { ProgressView(); Text("正在载入对话") }
            } else if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.circle").foregroundStyle(.red)
                Button("重试") { Task { await load() } }
            } else if overview?.friends.isEmpty != false {
                Text("成为好友后，对话会出现在这里。").foregroundStyle(.secondary)
            } else {
                ForEach(overview?.friends ?? []) { friend in
                    NavigationLink {
                        NativeChatView(client: client, accountID: accountID, friendUID: friend.uid)
                    } label: {
                        Label(friend.uid, systemImage: "person.crop.circle")
                    }
                }
            }
        }
        .lifePaperBackground()
        .navigationTitle("聊天")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do { overview = try await client.listFriends() }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }
}

private struct NativeChatView: View {
    let client: LifeOnlineClient
    let accountID: String
    let friendUID: String
    @State private var messages: [ChatMessage] = []
    @State private var draft = ""
    @State private var isLoading = false
    @State private var isSending = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            if isLoading && messages.isEmpty {
                HStack { ProgressView(); Text("正在载入消息") }
            }
            ForEach(messages) { message in
                VStack(alignment: .leading, spacing: 4) {
                    Text(message.senderUid == accountID ? "你" : friendUID)
                        .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Text(message.body).textSelection(.enabled)
                }
                .padding(.vertical, 4)
            }
            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.circle").foregroundStyle(.red)
            }
        }
        .lifePaperBackground()
        .navigationTitle(friendUID)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .safeAreaInset(edge: .bottom) {
            HStack(spacing: 10) {
                TextField("输入消息", text: $draft, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                Button {
                    Task { await send() }
                } label: {
                    if isSending { ProgressView() }
                    else { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                }
                .disabled(isSending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel(isSending ? "正在发送消息" : "发送消息")
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(LifeTheme.raisedPaper)
        }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do { messages = try await client.listMessages(with: friendUID) }
        catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    private func send() async {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        isSending = true
        errorMessage = nil
        let clientID = UUID().uuidString
        do {
            let acknowledged = try await client.sendMessage(to: friendUID, body: body, clientMessageID: clientID)
            if !messages.contains(where: { $0.id == acknowledged.id }) {
                messages.append(acknowledged)
            }
            draft = ""
        } catch {
            errorMessage = error.localizedDescription
        }
        isSending = false
    }
}
