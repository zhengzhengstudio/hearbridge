import SwiftUI

/// 合规声明与口径管理（Apple 端）。
///
/// 与 Android `Compliance.kt`、HarmonyOS `Compliance.ets` 保持完全一致的口径：
/// 本应用是纯本地的交易流程学习工具，不接入真实券商通道，
/// 不提供证券投资咨询，不构成投资建议。界面文案避免出现
/// 「炒股」「真实行情」「荐股」「收益」等易触发金融风控审核的表述。
enum Compliance {
    /// 应用对外显示名，避免「炒股」等词
    static let appName = "铮铮交易练习"
    static let appTagline = "模拟交易练习 · 虚构行情数据"

    static let disclaimer = """
    本应用是一款用于学习交易流程的模拟练习工具，所有价格、资金与持仓均为程序虚构，\
    不接入任何真实券商或交易通道，不涉及真实资金，不提供证券投资咨询，\
    也不构成任何投资建议。行情数据仅供参考学习，请勿据此进行真实投资决策。\
    市场有风险，投资需谨慎；任何依据模拟结果作出的真实决策，风险由个人自行承担。
    """

    static let shortNotice = "模拟练习数据 · 不构成投资建议"

    /// 关于本应用（逐条展示，便于合规留档）
    static let aboutPoints = [
        "本应用为技术学习与交易流程练习工具，非证券经营机构，不持有任何金融牌照。",
        "所有股票名称、价格、涨跌幅、成交量均由本地程序随机或按固定规则生成，属虚构数据。",
        "本应用不接入真实券商交易通道，不支持真实资金存取、下单与撮合。",
        "本应用不提供证券投资咨询、荐股服务或收益承诺，亦不构成任何投资建议。",
        "本应用不会收集账号密码、银行卡、身份证或资金信息。",
        "所展示的「行情观察」等指标仅为教学演示的数学计算结果，不代表任何预测能力。",
        "使用本应用产生的任何后果由使用者自行承担。"
    ]

    static let privacy = """
    本应用仅在设备本地保存练习记录（昵称、虚拟资金、模拟持仓）。\
    应用不采集、不上传、不存储、不共享您的个人身份信息、通讯录、位置、相机或麦克风数据。\
    唯一可能发生的网络访问是：您主动刷新时读取公开行情，以及检查更新与下载公开文件。\
    此类访问不包含任何可识别个人身份的信息。卸载应用即彻底删除全部本地数据。
    """

    /// 行情数据模式的对外称呼
    static func modeLabel(_ mode: DataMode) -> String {
        switch mode {
        case .real: return "服务器演示数据"
        case .hybrid: return "混合演示数据"
        case .simulation: return "本地演示数据"
        }
    }

    /// 状态栏文案：避免「实盘」「真实行情」等表述
    static func statusLabel(_ raw: String) -> String {
        raw
            .replacingOccurrences(of: "服务器行情正在同步", with: "正在获取演示行情")
            .replacingOccurrences(of: "服务器暂不可用，本地补帧中", with: "服务器不可用，已切换本地演算")
            .replacingOccurrences(of: "真实行情不可用", with: "服务器演示数据不可用")
            .replacingOccurrences(of: "纯内部演算", with: "本地演示演算")
    }
}
