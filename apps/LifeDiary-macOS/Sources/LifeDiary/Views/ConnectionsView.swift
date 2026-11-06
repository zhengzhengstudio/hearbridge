import AppKit
import SwiftUI

struct ConnectionsView: View {
    let section: LifeSection
    let selectedEntry: DiaryEntry?
    let api: LifeAPIClient
    @ObservedObject var passport: PassportSession
    let outbox: CommunityOutbox?
    @State private var posts: [RemoteCommunityPost] = []
    @State private var friends: FriendsOverview?
    @State private var searchResults: [FriendUser] = []
    @State private var messages: [ChatMessage] = []
    @State private var query = ""
    @State private var peerID = ""
    @State private var message = ""
    @State private var pendingSend: PendingChatSend?
    @State private var isLoading = false
    @State private var isLoadingMessages = false
    @State private var errorText: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(section.title).font(.system(size: 30, weight: .semibold))
                if section != .community && passport.accountID == nil { LoginGate(passport: passport) }
                else { content }
                if isLoading { ProgressView("正在连接…") }
                if let errorText {
                    Label(errorText, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                    Button("重新载入") { Task { await load() } }
                }
            }
            .frame(maxWidth: 760, alignment: .leading).padding(28)
        }
        .task(id: section) { await load() }
    }

    @ViewBuilder private var content: some View {
        switch section {
        case .community: communityContent
        case .friends: friendsContent
        case .messages: messagesContent
        default: EmptyView()
        }
    }

    private var communityContent: some View {
        Group {
            if let entry = selectedEntry {
                HStack {
                    Text("公开副本：\(entry.title)").foregroundStyle(.secondary)
                    Spacer()
                    Button("确认发布副本") { Task { await publish(entry) } }
                        .disabled(passport.accountID == nil || outbox == nil || isLoading)
                }
            } else { Text("在中间栏选择一篇日记，才可创建独立的公开副本。").foregroundStyle(.secondary) }
            Divider()
            ForEach(posts) { post in
                VStack(alignment: .leading, spacing: 5) {
                    Text(post.topic).font(.headline); Text(post.body)
                    Text("\(post.author.nickname) · \(post.likeCount) 次喜欢").font(.caption).foregroundStyle(.secondary)
                }.padding(.vertical, 5)
            }
        }
    }

    private var friendsContent: some View {
        Group {
            HStack {
                TextField("搜索昵称或 UID", text: $query)
                Button("搜索") { Task { await searchFriend() } }.disabled(query.trimmingCharacters(in: .whitespaces).isEmpty || isLoading)
            }
            if !searchResults.isEmpty {
                Text("搜索结果").font(.headline)
                ForEach(searchResults) { user in
                    HStack { Label("\(user.nickname) · \(user.uid)", systemImage: "person.crop.circle.badge.plus"); Spacer(); Button("申请好友") { Task { await requestFriend(user.uid) } } }
                }
            }
            if let requests = friends?.requests.filter({ $0.status == "pending" }), !requests.isEmpty {
                Text("好友申请").font(.headline)
                ForEach(requests) { request in
                    HStack {
                        Text(request.fromUid == passport.accountID ? "已向 \(request.toUid) 申请" : "来自 \(request.fromUid)")
                        Spacer()
                        if request.toUid == passport.accountID {
                            Button("接受") { Task { await respond(request.id, action: "accept") } }
                            Button("拒绝", role: .destructive) { Task { await respond(request.id, action: "reject") } }
                        }
                    }
                }
            }
            Text("我的好友").font(.headline)
            ForEach(friends?.friends ?? []) { friend in Label(friend.uid, systemImage: "person.crop.circle") }
        }
    }

    private var messagesContent: some View {
        Group {
            HStack {
                TextField("好友 UID", text: $peerID)
                Button("载入") { Task { await loadMessages() } }.disabled(peerID.isEmpty || isLoadingMessages)
            }
            if isLoadingMessages { ProgressView("正在载入消息…") }
            ForEach(messages) { item in Text(item.body).padding(9).background(.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 8)) }
            HStack {
                TextField("写一条消息", text: $message)
                Button("发送") { beginSend() }.disabled(peerID.isEmpty || message.isEmpty || pendingSend != nil)
            }
            if let pendingSend {
                HStack {
                    if pendingSend.isSending { ProgressView(); Text("正在发送“\(pendingSend.body)”") }
                    else if let failure = pendingSend.errorMessage {
                        Text("发送失败：\(failure)").foregroundStyle(.red)
                        Button("重试") { Task { await sendPendingMessage() } }
                        Button("放弃", role: .cancel) { self.pendingSend = nil }
                    }
                }
            }
        }
    }

    private func load() async {
        isLoading = true; errorText = nil
        defer { isLoading = false }
        do {
            switch section {
            case .community: posts = try await api.listCommunityPosts()
            case .friends: friends = try await api.listFriends()
            case .messages: if !peerID.isEmpty { await loadMessages() }
            default: break
            }
        } catch { errorText = error.localizedDescription }
    }

    private func publish(_ entry: DiaryEntry) async {
        guard passport.accountID != nil else { errorText = LifeAPIError.passportRequired.localizedDescription; return }
        guard let outbox else { errorText = "无法打开本机发布队列，请检查磁盘权限。"; return }
        isLoading = true; errorText = nil
        defer { isLoading = false }
        do {
            let draft = try outbox.draft(for: entry)
            _ = try await api.createPost(draft.publicPayload(minorConfirmed: true))
            try outbox.complete(draft)
            posts = try await api.listCommunityPosts()
        } catch { errorText = error.localizedDescription }
    }

    private func searchFriend() async {
        isLoading = true; errorText = nil
        defer { isLoading = false }
        do { searchResults = try await api.searchFriends(query: query) }
        catch { errorText = error.localizedDescription }
    }

    private func requestFriend(_ uid: String) async {
        isLoading = true; errorText = nil
        defer { isLoading = false }
        do { _ = try await api.requestFriend(uid: uid); friends = try await api.listFriends() }
        catch { errorText = error.localizedDescription }
    }

    private func respond(_ id: String, action: String) async {
        isLoading = true; errorText = nil
        defer { isLoading = false }
        do { _ = try await api.respondToFriendRequest(id: id, action: action); friends = try await api.listFriends() }
        catch { errorText = error.localizedDescription }
    }

    private func loadMessages() async {
        guard !peerID.isEmpty else { return }
        isLoadingMessages = true; errorText = nil
        defer { isLoadingMessages = false }
        do { messages = try await api.listMessages(with: peerID) }
        catch { errorText = error.localizedDescription }
    }

    private func beginSend() {
        pendingSend = PendingChatSend(body: message)
        message = ""
        Task { await sendPendingMessage() }
    }

    private func sendPendingMessage() async {
        guard var send = pendingSend, !send.isSending else { return }
        send.markSending(); pendingSend = send; errorText = nil
        do {
            let sent = try await api.sendMessage(to: peerID, body: send.body, clientMessageID: send.clientMessageID)
            messages.append(sent); pendingSend = nil
        } catch {
            send.markFailed(error.localizedDescription); pendingSend = send
        }
    }
}

struct LoginGate: View {
    @ObservedObject var passport: PassportSession
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("需要铮铮通行证", systemImage: "person.badge.key")
            Text("本地日记无需登录；连接服务只有在授权后才会请求服务器。").foregroundStyle(.secondary)
            Button("登录") { passport.beginAuthorization(anchor: NSApp.keyWindow) }
                .disabled(passport.authorizationStatus == .authorizing).buttonStyle(.borderedProminent)
            if passport.authorizationStatus == .authorizing { Button("取消登录", role: .cancel) { passport.cancelAuthorization() } }
        }
        .padding(18).background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }
}
