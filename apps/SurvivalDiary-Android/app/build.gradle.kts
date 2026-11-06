import org.gradle.api.GradleException

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val sharedRoot = layout.projectDirectory.dir("../../SurvivalDiaryShared")
val generatedRaw = layout.buildDirectory.dir("generated/survivalContent/res/raw")
val generatedAssets = layout.buildDirectory.dir("generated/survivalAssets")
val formalRasterRoot = layout.projectDirectory.dir("../../../website/survival-diary.zhengzhengstudio.cn/assets/game")

val syncSurvivalDiaryContent by tasks.registering(Sync::class) {
    from(sharedRoot.dir("content"))
    from(sharedRoot.dir("fixtures"))
    include("*.json")
    into(generatedRaw)
    rename { it.replace('-', '_') }
}

val syncSurvivalDiaryAssets by tasks.registering(Sync::class) {
    // The native renderer consumes the compact PNG atlas families below. Do not
    // package Web-only source sheets, review images, world-v4 frames, or duplicate
    // WebP LODs: they previously made the APK asset merge exceed 200 MB.
    from(formalRasterRoot) {
        include(
            "terrain/terrain-*/base.png",
            "building/building-*/world.png",
            "building/building-*/icon.png",
            "material/item-*/world.png",
            "material/item-*/icon.png",
            "material/resource-*/full.png",
            "resource/item-*/world.png",
            "resource/item-*/icon.png",
            "resource/resource-*/full.png",
            "food/item-*/world.png",
            "food/item-*/icon.png",
            "tool/item-*/world.png",
            "tool/item-*/icon.png",
            "medicine/item-*/world.png",
            "medicine/item-*/icon.png",
            "equipment/item-*/world.png",
            "equipment/item-*/icon.png",
            "animal/animal-*/idle.png",
            "animal/animal-*/walk.png",
        )
        into("survival-v3/game")
    }
    from(formalRasterRoot.dir("ground-material-v6")) {
        include("tropical-floor.webp", "coastal-earth.webp")
        into("survival-v3/game/ground-material-v6")
    }
    from(formalRasterRoot.dir("ground-v5")) {
        include("worn-path@0.5x.webp")
        into("survival-v3/game/ground-v5")
    }
    from(formalRasterRoot.dir("transport-v6")) {
        include("*.webp")
        exclude("*@0.5x.webp")
        into("survival-v3/game/transport-v6")
    }
    from(formalRasterRoot.dir("transport-v7")) {
        include("*.webp")
        exclude("*@0.5x.webp")
        into("survival-v3/game/transport-v7")
    }
    from(formalRasterRoot.dir("world-v4/transport")) {
        include("rowboat-empty@0.5x.webp", "rowboat-aboard@0.5x.webp")
        into("survival-v3/game/world-v4/transport")
    }
    from(formalRasterRoot.dir("world-v4/rail-segment")) {
        include("icon.png")
        into("survival-v3/game/world-v4/rail-segment")
    }
    from(formalRasterRoot.dir("fog-v8")) {
        include("unknown-island-fog.webp", "unknown-island-fog@0.5x.webp")
        into("survival-v3/game/fog-v8")
    }
    from(formalRasterRoot.dir("fog-v9")) {
        include("fog-bank-edge-v9.webp", "fog-bank-edge-v9@0.5x.webp")
        into("survival-v3/game/fog-v9")
    }
    from(formalRasterRoot.dir("ui-v6")) {
        include("island-compass.webp", "action-primary.webp", "action-secondary.webp", "hud-frame-leather.webp", "hud-frame-driftwood.webp")
        into("survival-v3/game/ui-v6")
    }
    from(formalRasterRoot.dir("ui-v9")) {
        include("panel-frame.png", "action-plaque.png")
        into("survival-v3/game/ui-v9")
    }
    from(formalRasterRoot.dir("villager-v8")) {
        include("atuo-*.png", "lanshang-*.png", "heyi-*.png", "wanderer-*.png")
        into("survival-v3/game/villager-v8")
    }
    from(formalRasterRoot.dir("tutorial-v1")) {
        include("distant-smoke-column.png")
        into("survival-v3/game/tutorial-v1")
    }
    from(formalRasterRoot.dir("world-v4/villagers/castaway-builder")) {
        include("idle-south-01.png", "talk-south-01.png", "walk-south-01.png", "work-haul-south-01.png")
        into("survival-v3/game/villagers/castaway-builder")
    }
    from(formalRasterRoot.dir("world-v4/agriculture")) {
        include("taro-seeded.png", "millet-seeded.png", "medicinal-herb-seeded.png", "taro-harvested.png", "millet-harvested.png")
        into("survival-v3/game/world-v4/agriculture")
    }
    from(formalRasterRoot.dir("world-v4/resources")) {
        include(
            "driftwood-pile-large-full@0.5x.webp", "fallen-branches-full@0.5x.webp",
            "softwood-tree-medium-full@0.5x.webp", "hardwood-tree-large-full@0.5x.webp",
            "bamboo-grove-small-full@0.5x.webp", "palm-fiber-clump-full@0.5x.webp",
            "vine-thicket-full@0.5x.webp", "broadleaf-bush-large-full@0.5x.webp",
            "stone-outcrop-small-full@0.5x.webp", "coal-seam-full@0.5x.webp",
            "copper-vein-full@0.5x.webp", "tin-vein-full@0.5x.webp",
            "iron-vein-full@0.5x.webp", "sulfur-vent-full@0.5x.webp",
            "quartz-vein-full@0.5x.webp", "coconut-palm-small-full@0.5x.webp",
            "herb-patch-full@0.5x.webp", "seaweed-bed-full@0.5x.webp",
            "clam-bed-full@0.5x.webp", "fresh-water-spring-full@0.5x.webp",
        )
        into("survival-v3/game/world-resources")
    }
    from(sharedRoot.dir("content")) { into("survival-v3/content") }
    from(sharedRoot.dir("assets")) {
        include("asset-manifest.json")
        into("survival-v3")
    }
    into(generatedAssets)
}

android {
    namespace = "cn.zhengzhengstudio.survivaldiary"
    compileSdk = 34

    defaultConfig {
        applicationId = "cn.zhengzhengstudio.survivaldiary"
        minSdk = 26
        targetSdk = 34
        versionCode = 46
        versionName = "0.6.2"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "MANIFEST_URL", "\"https://zhengzhengstudio.cn/api/apps/manifest.json\"")
    }

    signingConfigs {
        create("survivalRelease") {
            val keyFile = System.getenv("SURVIVAL_DIARY_KEYSTORE")
            if (!keyFile.isNullOrBlank()) storeFile = file(keyFile)
            storePassword = System.getenv("SURVIVAL_DIARY_STORE_PASSWORD")
            keyAlias = System.getenv("SURVIVAL_DIARY_KEY_ALIAS") ?: "survival-diary-release"
            keyPassword = System.getenv("SURVIVAL_DIARY_KEY_PASSWORD")
            storeType = "PKCS12"
        }
    }

    flavorDimensions += "distribution"
    productFlavors {
        create("website") {
            dimension = "distribution"
            buildConfigField("String", "DISTRIBUTION", "\"website\"")
        }
        create("play") {
            dimension = "distribution"
            buildConfigField("String", "DISTRIBUTION", "\"play\"")
        }
    }

    buildTypes {
        debug { applicationIdSuffix = ".debug" }
        release {
            isDebuggable = false
            isMinifyEnabled = true
            signingConfig = signingConfigs.getByName("survivalRelease")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures { compose = true; buildConfig = true }
    composeOptions { kotlinCompilerExtensionVersion = "1.5.14" }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    sourceSets.getByName("main").res.srcDir(generatedRaw)
    sourceSets.getByName("main").assets.srcDir(generatedAssets)
    packaging.resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
}

tasks.named("preBuild").configure { dependsOn(syncSurvivalDiaryContent, syncSurvivalDiaryAssets) }

gradle.taskGraph.whenReady {
    val requestsRelease = allTasks.any { it.path.contains("Release") && (it.name.startsWith("assemble") || it.name.startsWith("bundle")) }
    if (requestsRelease) {
        val required = listOf("SURVIVAL_DIARY_KEYSTORE", "SURVIVAL_DIARY_STORE_PASSWORD", "SURVIVAL_DIARY_KEY_PASSWORD")
        val missing = required.filter { System.getenv(it).isNullOrBlank() }
        if (missing.isNotEmpty()) throw GradleException("Missing Survival Diary release signing credentials: ${missing.joinToString()}")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.3")
    implementation("androidx.compose.ui:ui:1.6.8")
    implementation("androidx.compose.ui:ui-tooling-preview:1.6.8")
    implementation("androidx.compose.material3:material3:1.2.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    debugImplementation("androidx.compose.ui:ui-tooling:1.6.8")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
