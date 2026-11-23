#!/usr/bin/env python3
"""Regenerate apple/KintampoMarket.xcodeproj so every .swift file is in the targets."""
from __future__ import annotations

import os
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "KintampoMarket"
MGR = ROOT / "KintampoManager"
PROJ = ROOT / "KintampoMarket.xcodeproj" / "project.pbxproj"


def uid(seed: str) -> str:
    return uuid.uuid5(uuid.NAMESPACE_URL, seed).hex[:24].upper()


def collect_swift() -> list[Path]:
    files = sorted(SRC.rglob("*.swift")) + sorted(MGR.rglob("*.swift"))
    return [p for p in files if p.is_file()]


# Kintampo Manager (staff app) compiles its own folder plus these shared customer-app
# folders/files. It never gets the shopping screens, and the customer app never gets
# anything from KintampoManager/.
MANAGER_SHARED_DIRS = ("KintampoMarket/Models/", "KintampoMarket/Services/", "KintampoMarket/Theme/")
MANAGER_SHARED_FILES = {
    "KintampoMarket/Views/Components/OrderStatusViews.swift",
    "KintampoMarket/Views/Components/Skeletons.swift",
}
MANAGER_EXCLUDE = {"KintampoMarket/Services/PushRegistration.swift"}


def in_manager(r: str) -> bool:
    if r.startswith("KintampoManager/"):
        return True
    if r in MANAGER_EXCLUDE:
        return False
    return r in MANAGER_SHARED_FILES or r.startswith(MANAGER_SHARED_DIRS)


def rel(p: Path) -> str:
    return str(p.relative_to(ROOT)).replace("\\", "/")


# The customer app ships iPhone-only (TARGETED_DEVICE_FAMILY = 1): its layout is designed for
# phones, and App Review rejects iPad builds that are a stretched phone layout. iPads can still
# run it in iPhone compatibility mode. Revisit when there is a real iPad layout.


def main() -> None:
    swifts = collect_swift()
    # Shared by iOS + Mac; Watch gets a slim set
    watch_allow = {
        "KintampoMarketApp.swift",
        "WatchRootView.swift",
        "Brand.swift",
        "StoreConfig.swift",
        "Product.swift",
        "MoreModels.swift",
        "AppConfig.swift",
        "CartStore.swift",
        "CatalogStore.swift",
        "SupabaseService.swift",
        "APIClient.swift",
        "AccountStores.swift",
        "SessionVault.swift",
        "ViewModels.swift",
        "ImageCache.swift",
        "StorefrontCatalog.swift",
        "AppRouter.swift",
    }

    stripe_package = uid("package:stripe")
    stripe_product = uid("package:StripePaymentSheet")
    stripe_build = uid("build:StripePaymentSheet")
    file_refs: dict[str, str] = {}
    build_ios: list[tuple[str, str]] = []
    build_mac: list[tuple[str, str]] = []
    build_watch: list[tuple[str, str]] = []
    build_mgr: list[tuple[str, str]] = []

    for path in swifts:
        r = rel(path)
        fr = uid(f"file:{r}")
        file_refs[r] = fr
        if in_manager(r):
            build_mgr.append((uid(f"mgr:{r}"), fr))
        if r.startswith("KintampoManager/"):
            continue
        bi = uid(f"ios:{r}")
        bm = uid(f"mac:{r}")
        build_ios.append((bi, fr))
        build_mac.append((bm, fr))
        if path.name in watch_allow:
            bw = uid(f"watch:{r}")
            build_watch.append((bw, fr))

    # Group structure by folder
    groups: dict[str, list[str]] = {}
    for r in file_refs:
        parent = str(Path(r).parent)
        groups.setdefault(parent, []).append(r)

    info_ios = uid("info:ios")
    info_mac = uid("info:mac")
    info_watch = uid("info:watch")
    config_ref = uid("config:xcconfig")
    product_ios = uid("product:ios")
    product_mac = uid("product:mac")
    product_watch = uid("product:watch")
    product_mgr = uid("product:mgr")
    info_mgr = uid("info:mgr")
    mgr_assets_ref = uid("assets:catalog:mgr")
    assets_build_mgr = uid("assets:build:mgr")
    privacy_build_mgr = uid("privacy:build:mgr")
    assets_ref = uid("assets:catalog")
    privacy_ref = uid("privacy:manifest")
    assets_build_ios = uid("assets:build:ios")
    privacy_build_ios = uid("privacy:build:ios")
    assets_build_mac = uid("assets:build:mac")
    privacy_build_mac = uid("privacy:build:mac")

    lines: list[str] = []
    lines.append("// !$*UTF8*$!")
    lines.append("{")
    lines.append("\tarchiveVersion = 1;")
    lines.append("\tclasses = {};")
    lines.append("\tobjectVersion = 56;")
    lines.append("\tobjects = {")

    lines.append(f'{stripe_package} = {{isa = XCRemoteSwiftPackageReference; repositoryURL = "https://github.com/stripe/stripe-ios.git"; requirement = {{kind = exactVersion; version = 25.9.0; }}; }};')
    lines.append(f'{stripe_product} = {{isa = XCSwiftPackageProductDependency; package = {stripe_package}; productName = StripePaymentSheet; }};')
    lines.append(f'{stripe_build} = {{isa = PBXBuildFile; productRef = {stripe_product}; }};')
    # PBXBuildFile
    lines.append("\n/* Begin PBXBuildFile section */")
    for bi, fr in build_ios:
        name = next(k for k, v in file_refs.items() if v == fr)
        lines.append(f"\t\t{bi} /* {Path(name).name} in Sources */ = {{isa = PBXBuildFile; fileRef = {fr} /* {Path(name).name} */; }};")
    for bm, fr in build_mac:
        name = next(k for k, v in file_refs.items() if v == fr)
        lines.append(f"\t\t{bm} /* {Path(name).name} in Sources */ = {{isa = PBXBuildFile; fileRef = {fr} /* {Path(name).name} */; }};")
    for bw, fr in build_watch:
        name = next(k for k, v in file_refs.items() if v == fr)
        lines.append(f"\t\t{bw} /* {Path(name).name} in Sources */ = {{isa = PBXBuildFile; fileRef = {fr} /* {Path(name).name} */; }};")
    for bg, fr in build_mgr:
        name = next(k for k, v in file_refs.items() if v == fr)
        lines.append(f"\t\t{bg} /* {Path(name).name} in Sources */ = {{isa = PBXBuildFile; fileRef = {fr} /* {Path(name).name} */; }};")
    lines.append(f"\t\t{assets_build_mgr} /* Assets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {mgr_assets_ref} /* Assets.xcassets */; }};")
    lines.append(f"\t\t{privacy_build_mgr} /* PrivacyInfo.xcprivacy in Resources */ = {{isa = PBXBuildFile; fileRef = {privacy_ref} /* PrivacyInfo.xcprivacy */; }};")
    lines.append(f"\t\t{assets_build_ios} /* Assets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {assets_ref} /* Assets.xcassets */; }};")
    lines.append(f"\t\t{privacy_build_ios} /* PrivacyInfo.xcprivacy in Resources */ = {{isa = PBXBuildFile; fileRef = {privacy_ref} /* PrivacyInfo.xcprivacy */; }};")
    lines.append(f"\t\t{assets_build_mac} /* Assets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {assets_ref} /* Assets.xcassets */; }};")
    lines.append(f"\t\t{privacy_build_mac} /* PrivacyInfo.xcprivacy in Resources */ = {{isa = PBXBuildFile; fileRef = {privacy_ref} /* PrivacyInfo.xcprivacy */; }};")
    lines.append("/* End PBXBuildFile section */\n")

    # File refs
    lines.append("/* Begin PBXFileReference section */")
    for r, fr in file_refs.items():
        lines.append(
            f"\t\t{fr} /* {Path(r).name} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {Path(r).name}; sourceTree = \"<group>\"; }};"
        )
    lines.append(f"\t\t{info_ios} /* Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = \"<group>\"; }};")
    lines.append(f"\t\t{info_mac} /* Info-macOS.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = \"Info-macOS.plist\"; sourceTree = \"<group>\"; }};")
    lines.append(f"\t\t{info_watch} /* Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = \"<group>\"; }};")
    lines.append(f"\t\t{config_ref} /* Config.xcconfig */ = {{isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = Config.xcconfig; sourceTree = \"<group>\"; }};")
    lines.append(f"\t\t{assets_ref} /* Assets.xcassets */ = {{isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = \"<group>\"; }};")
    lines.append(f"\t\t{privacy_ref} /* PrivacyInfo.xcprivacy */ = {{isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = \"<group>\"; }};")
    lines.append(f"\t\t{product_ios} /* KintampoMarket.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = KintampoMarket.app; sourceTree = BUILT_PRODUCTS_DIR; }};")
    lines.append(f"\t\t{product_mac} /* KintampoMarketMac.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = KintampoMarketMac.app; sourceTree = BUILT_PRODUCTS_DIR; }};")
    lines.append(f"\t\t{info_mgr} /* Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = \"<group>\"; }};")
    lines.append(f"\t\t{mgr_assets_ref} /* Assets.xcassets */ = {{isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = \"<group>\"; }};")
    lines.append(f"\t\t{product_mgr} /* KintampoManager.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = KintampoManager.app; sourceTree = BUILT_PRODUCTS_DIR; }};")
    lines.append(f"\t\t{product_watch} /* KintampoMarketWatch.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = KintampoMarketWatch.app; sourceTree = BUILT_PRODUCTS_DIR; }};")
    lines.append("/* End PBXFileReference section */\n")

    # Groups — flatten under KintampoMarket with nested folders
    group_ids: dict[str, str] = {}
    for g in sorted(groups.keys()):
        group_ids[g] = uid(f"group:{g}")

    root_group = uid("group:root")
    products_group = uid("group:products")
    km_group = uid("group:km")
    watch_info_group = uid("group:watchinfo")
    mgr_group = uid("group:mgr")
    mgr_resources_group = uid("group:mgr:resources")

    lines.append("/* Begin PBXGroup section */")
    resources_group = uid("group:resources")
    lines.append(f"\t\t{root_group} = {{isa = PBXGroup; children = ({km_group}, {mgr_group}, {watch_info_group}, {products_group}, {config_ref}); sourceTree = \"<group>\"; }};")
    lines.append(f"\t\t{products_group} /* Products */ = {{isa = PBXGroup; children = ({product_ios}, {product_mac}, {product_watch}, {product_mgr}); name = Products; sourceTree = \"<group>\"; }};")
    lines.append(f"\t\t{watch_info_group} /* KintampoMarketWatch */ = {{isa = PBXGroup; children = ({info_watch}); path = KintampoMarketWatch; sourceTree = \"<group>\"; }};")
    lines.append(f"\t\t{resources_group} /* Resources */ = {{isa = PBXGroup; children = ({assets_ref}); path = Resources; sourceTree = \"<group>\"; }};")

    # Top KintampoMarket group children = subgroup ids + root-level swift + plists
    top_children = []
    for g in sorted(groups.keys()):
        if g == "KintampoMarket":
            continue
        # only direct subfolders of KintampoMarket
        if Path(g).parts[0] == "KintampoMarket" and len(Path(g).parts) == 2:
            if Path(g).parts[1] == "Resources":
                continue
            top_children.append(group_ids[g])
    for r in groups.get("KintampoMarket", []):
        top_children.append(file_refs[r])
    top_children.extend([info_ios, info_mac, resources_group, privacy_ref])
    lines.append(
        f"\t\t{km_group} /* KintampoMarket */ = {{isa = PBXGroup; children = ({', '.join(top_children)}); path = KintampoMarket; sourceTree = \"<group>\"; }};"
    )

    for g, files in groups.items():
        if g == "KintampoMarket":
            continue
        parts = Path(g).parts
        if parts[0] != "KintampoMarket":
            continue
        # nested: Theme, Models, Services, ViewModels, Views, Views/Components, Platform
        if len(parts) == 2:
            kids = []
            # nested subgroups under Views
            for ng in sorted(groups.keys()):
                np = Path(ng).parts
                if len(np) == 3 and np[0] == "KintampoMarket" and np[1] == parts[1]:
                    kids.append(group_ids[ng])
            kids.extend(file_refs[f] for f in sorted(files))
            lines.append(
                f"\t\t{group_ids[g]} /* {parts[1]} */ = {{isa = PBXGroup; children = ({', '.join(kids)}); path = {parts[1]}; sourceTree = \"<group>\"; }};"
            )
        elif len(parts) == 3:
            kids = [file_refs[f] for f in sorted(files)]
            lines.append(
                f"\t\t{group_ids[g]} /* {parts[2]} */ = {{isa = PBXGroup; children = ({', '.join(kids)}); path = {parts[2]}; sourceTree = \"<group>\"; }};"
            )

    # Kintampo Manager folder: one level of subfolders (Models, Services, Views) + Resources.
    mgr_children = [group_ids[g] for g in sorted(groups) if Path(g).parts[0] == "KintampoManager" and len(Path(g).parts) == 2]
    mgr_children += [file_refs[r] for r in sorted(groups.get("KintampoManager", []))]
    mgr_children += [info_mgr, mgr_resources_group]
    lines.append(
        f"\t\t{mgr_group} /* KintampoManager */ = {{isa = PBXGroup; children = ({', '.join(mgr_children)}); path = KintampoManager; sourceTree = \"<group>\"; }};"
    )
    lines.append(f"\t\t{mgr_resources_group} /* Resources */ = {{isa = PBXGroup; children = ({mgr_assets_ref}); path = Resources; sourceTree = \"<group>\"; }};")
    for g in sorted(groups):
        parts = Path(g).parts
        if parts[0] == "KintampoManager" and len(parts) == 2:
            kids = [file_refs[f] for f in sorted(groups[g])]
            lines.append(
                f"\t\t{group_ids[g]} /* {parts[1]} */ = {{isa = PBXGroup; children = ({', '.join(kids)}); path = {parts[1]}; sourceTree = \"<group>\"; }};"
            )

    lines.append("/* End PBXGroup section */\n")

    # Targets
    t_ios, t_mac, t_watch = uid("target:ios"), uid("target:mac"), uid("target:watch")
    t_mgr, s_mgr, f_mgr, r_mgr, c_mgr = uid("target:mgr"), uid("sources:mgr"), uid("fw:mgr"), uid("res:mgr"), uid("cfglist:mgr")
    s_ios, s_mac, s_watch = uid("sources:ios"), uid("sources:mac"), uid("sources:watch")
    f_ios, f_mac, f_watch = uid("fw:ios"), uid("fw:mac"), uid("fw:watch")
    r_ios, r_mac, r_watch = uid("res:ios"), uid("res:mac"), uid("res:watch")
    c_ios, c_mac, c_watch = uid("cfglist:ios"), uid("cfglist:mac"), uid("cfglist:watch")
    c_proj = uid("cfglist:proj")
    proxy = uid("proxy:watch")
    dep = uid("dep:watch")
    proj = uid("project:root")

    lines.append("/* Begin PBXNativeTarget section */")
    lines.append(f"""\t\t{t_ios} /* KintampoMarket */ = {{
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = {c_ios};
\t\t\tbuildPhases = ({s_ios}, {f_ios}, {r_ios});
\t\t\tbuildRules = ();
\t\t\tdependencies = ();
\t\t\tpackageProductDependencies = ({stripe_product});
\t\t\tname = KintampoMarket;
\t\t\tproductName = KintampoMarket;
\t\t\tproductReference = {product_ios};
\t\t\tproductType = \"com.apple.product-type.application\";
\t\t}};""")
    lines.append(f"""\t\t{t_mac} /* KintampoMarketMac */ = {{
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = {c_mac};
\t\t\tbuildPhases = ({s_mac}, {f_mac}, {r_mac});
\t\t\tbuildRules = ();
\t\t\tdependencies = ();
\t\t\tname = KintampoMarketMac;
\t\t\tproductName = KintampoMarketMac;
\t\t\tproductReference = {product_mac};
\t\t\tproductType = \"com.apple.product-type.application\";
\t\t}};""")
    lines.append(f"""\t\t{t_watch} /* KintampoMarketWatch */ = {{
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = {c_watch};
\t\t\tbuildPhases = ({s_watch}, {f_watch}, {r_watch});
\t\t\tbuildRules = ();
\t\t\tdependencies = ({dep});
\t\t\tname = KintampoMarketWatch;
\t\t\tproductName = KintampoMarketWatch;
\t\t\tproductReference = {product_watch};
\t\t\tproductType = \"com.apple.product-type.application\";
\t\t}};""")
    lines.append(f"""\t\t{t_mgr} /* KintampoManager */ = {{
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = {c_mgr};
\t\t\tbuildPhases = ({s_mgr}, {f_mgr}, {r_mgr});
\t\t\tbuildRules = ();
\t\t\tdependencies = ();
\t\t\tname = KintampoManager;
\t\t\tproductName = KintampoManager;
\t\t\tproductReference = {product_mgr};
\t\t\tproductType = \"com.apple.product-type.application\";
\t\t}};""")
    lines.append("/* End PBXNativeTarget section */\n")

    lines.append("/* Begin PBXProject section */")
    lines.append(f"""\t\t{proj} /* Project object */ = {{
\t\t\tisa = PBXProject;
\t\t\tattributes = {{ BuildIndependentTargetsInParallel = 1; LastSwiftUpdateCheck = 1500; LastUpgradeCheck = 1500; }};
\t\t\tbuildConfigurationList = {c_proj};
\t\t\tcompatibilityVersion = \"Xcode 14.0\";
\t\t\tdevelopmentRegion = en;
\t\t\thasScannedForEncodings = 0;
\t\t\tknownRegions = (en, Base);
\t\t\tmainGroup = {root_group};
\t\t\tproductRefGroup = {products_group};
\t\t\tprojectDirPath = \"\";
\t\t\tprojectRoot = \"\";
\t\t\tpackageReferences = ({stripe_package});
\t\t\ttargets = ({t_ios}, {t_mgr}, {t_mac}, {t_watch});
\t\t}};""")
    lines.append("/* End PBXProject section */\n")

    lines.append("/* Begin PBXSourcesBuildPhase section */")
    lines.append(f"\t\t{s_ios} = {{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({', '.join(b for b,_ in build_ios)}); runOnlyForDeploymentPostprocessing = 0; }};")
    lines.append(f"\t\t{s_mac} = {{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({', '.join(b for b,_ in build_mac)}); runOnlyForDeploymentPostprocessing = 0; }};")
    lines.append(f"\t\t{s_watch} = {{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({', '.join(b for b,_ in build_watch)}); runOnlyForDeploymentPostprocessing = 0; }};")
    lines.append(f"\t\t{s_mgr} = {{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({', '.join(b for b,_ in build_mgr)}); runOnlyForDeploymentPostprocessing = 0; }};")
    lines.append("/* End PBXSourcesBuildPhase section */\n")

    for fid in (f_ios, f_mac, f_watch, f_mgr):
        frameworks = stripe_build if fid == f_ios else ""
        lines.append(f"\t\t{fid} = {{isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = ({frameworks}); runOnlyForDeploymentPostprocessing = 0; }};")
    lines.append(f"\t\t{r_ios} = {{isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({assets_build_ios}, {privacy_build_ios}); runOnlyForDeploymentPostprocessing = 0; }};")
    lines.append(f"\t\t{r_mac} = {{isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({assets_build_mac}, {privacy_build_mac}); runOnlyForDeploymentPostprocessing = 0; }};")
    lines.append(f"\t\t{r_watch} = {{isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; }};")
    lines.append(f"\t\t{r_mgr} = {{isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({assets_build_mgr}, {privacy_build_mgr}); runOnlyForDeploymentPostprocessing = 0; }};")

    lines.append(f"\t\t{dep} = {{isa = PBXTargetDependency; target = {t_ios}; targetProxy = {proxy}; }};")
    lines.append(f"\t\t{proxy} = {{isa = PBXContainerItemProxy; containerPortal = {proj}; proxyType = 1; remoteGlobalIDString = {t_ios}; remoteInfo = KintampoMarket; }};")

    def cfg(name: str, settings: dict[str, str]) -> str:
        body = "\n".join(f"\t\t\t\t{k} = {v};" for k, v in settings.items())
        return f"""\t\t{uid('bc:'+name)} /* {name.split(':')[-1]} */ = {{
\t\t\tisa = XCBuildConfiguration;
\t\t\tbaseConfigurationReference = {config_ref};
\t\t\tbuildSettings = {{
{body}
\t\t\t}};
\t\t\tname = {name.split(':')[-1]};
\t\t}};"""

    # We'll manually assign known IDs for config lists
    d_proj_d, d_proj_r = uid("bc:proj:Debug"), uid("bc:proj:Release")
    d_ios_d, d_ios_r = uid("bc:ios:Debug"), uid("bc:ios:Release")
    d_mac_d, d_mac_r = uid("bc:mac:Debug"), uid("bc:mac:Release")
    d_watch_d, d_watch_r = uid("bc:watch:Debug"), uid("bc:watch:Release")
    d_mgr_d, d_mgr_r = uid("bc:mgr:Debug"), uid("bc:mgr:Release")
    mgr_extra = "\t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;\n\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 17.0;\n\t\t\t\tSUPPORTED_PLATFORMS = \"iphoneos iphonesimulator\";\n\t\t\t\tTARGETED_DEVICE_FAMILY = \"1,2\";"

    lines.append("/* Begin XCBuildConfiguration section */")
    lines.append(f"""\t\t{d_proj_d} /* Debug */ = {{
\t\t\tisa = XCBuildConfiguration; baseConfigurationReference = {config_ref};
\t\t\tbuildSettings = {{
\t\t\t\tALWAYS_SEARCH_USER_PATHS = NO;
\t\t\t\tCLANG_ENABLE_MODULES = YES;
\t\t\t\tDEBUG_INFORMATION_FORMAT = dwarf;
\t\t\t\tONLY_ACTIVE_ARCH = YES;
\t\t\t\tSWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;
\t\t\t\tSWIFT_OPTIMIZATION_LEVEL = "-Onone";
\t\t\t}};
\t\t\tname = Debug;
\t\t}};""")
    lines.append(f"""\t\t{d_proj_r} /* Release */ = {{
\t\t\tisa = XCBuildConfiguration; baseConfigurationReference = {config_ref};
\t\t\tbuildSettings = {{
\t\t\t\tALWAYS_SEARCH_USER_PATHS = NO;
\t\t\t\tCLANG_ENABLE_MODULES = YES;
\t\t\t\tDEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";
\t\t\t\tSWIFT_COMPILATION_MODE = wholemodule;
\t\t\t\tSWIFT_OPTIMIZATION_LEVEL = "-O";
\t\t\t}};
\t\t\tname = Release;
\t\t}};""")

    def target_settings(plist: str, bundle: str, product: str, sdk: str, extra: str = "") -> str:
        return f"""
\t\t\t\tALWAYS_SEARCH_USER_PATHS = NO;
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCURRENT_PROJECT_VERSION = 1;
\t\t\t\tGENERATE_INFOPLIST_FILE = NO;
\t\t\t\tINFOPLIST_FILE = {plist};
\t\t\t\tMARKETING_VERSION = 1.0;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = {bundle};
\t\t\t\tPRODUCT_NAME = {product};
\t\t\t\tSDKROOT = {sdk};
\t\t\t\tSWIFT_VERSION = 5.0;
{extra}"""

    for cid, name, settings in [
        (d_ios_d, "Debug", target_settings("KintampoMarket/Info.plist", "com.kintampoafricanmarket.app", "KintampoMarket", "iphoneos",
            "\t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = KintampoMarket/KintampoMarket.entitlements;\n\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 17.0;\n\t\t\t\tSUPPORTED_PLATFORMS = \"iphoneos iphonesimulator\";\n\t\t\t\tSUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = NO;\n\t\t\t\tTARGETED_DEVICE_FAMILY = 1;")),
        (d_ios_r, "Release", target_settings("KintampoMarket/Info.plist", "com.kintampoafricanmarket.app", "KintampoMarket", "iphoneos",
            "\t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = KintampoMarket/KintampoMarket.entitlements;\n\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 17.0;\n\t\t\t\tSUPPORTED_PLATFORMS = \"iphoneos iphonesimulator\";\n\t\t\t\tSUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = NO;\n\t\t\t\tTARGETED_DEVICE_FAMILY = 1;")),
        (d_mac_d, "Debug", target_settings("\"KintampoMarket/Info-macOS.plist\"", "com.kintampoafricanmarket.app.mac", "KintampoMarketMac", "macosx",
            "\t\t\t\tMACOSX_DEPLOYMENT_TARGET = 14.0;")),
        (d_mac_r, "Release", target_settings("\"KintampoMarket/Info-macOS.plist\"", "com.kintampoafricanmarket.app.mac", "KintampoMarketMac", "macosx",
            "\t\t\t\tMACOSX_DEPLOYMENT_TARGET = 14.0;")),
        (d_watch_d, "Debug", target_settings("KintampoMarketWatch/Info.plist", "com.kintampoafricanmarket.app.watchkitapp", "KintampoMarketWatch", "watchos",
            "\t\t\t\tWATCHOS_DEPLOYMENT_TARGET = 10.0;\n\t\t\t\tTARGETED_DEVICE_FAMILY = 4;\n\t\t\t\tSKIP_INSTALL = YES;\n\t\t\t\tWK_COMPANION_APP_BUNDLE_IDENTIFIER = com.kintampoafricanmarket.app;")),
        (d_watch_r, "Release", target_settings("KintampoMarketWatch/Info.plist", "com.kintampoafricanmarket.app.watchkitapp", "KintampoMarketWatch", "watchos",
            "\t\t\t\tWATCHOS_DEPLOYMENT_TARGET = 10.0;\n\t\t\t\tTARGETED_DEVICE_FAMILY = 4;\n\t\t\t\tSKIP_INSTALL = YES;\n\t\t\t\tWK_COMPANION_APP_BUNDLE_IDENTIFIER = com.kintampoafricanmarket.app;")),
        (d_mgr_d, "Debug", target_settings("KintampoManager/Info.plist", "com.kintampoafricanmarket.manager", "KintampoManager", "iphoneos", mgr_extra)),
        (d_mgr_r, "Release", target_settings("KintampoManager/Info.plist", "com.kintampoafricanmarket.manager", "KintampoManager", "iphoneos", mgr_extra)),
    ]:
        lines.append(f"\t\t{cid} /* {name} */ = {{isa = XCBuildConfiguration; baseConfigurationReference = {config_ref}; buildSettings = {{{settings}\n\t\t\t}}; name = {name}; }};")

    lines.append("/* End XCBuildConfiguration section */\n")

    lines.append("/* Begin XCConfigurationList section */")
    lines.append(f"\t\t{c_proj} = {{isa = XCConfigurationList; buildConfigurations = ({d_proj_d}, {d_proj_r}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }};")
    lines.append(f"\t\t{c_ios} = {{isa = XCConfigurationList; buildConfigurations = ({d_ios_d}, {d_ios_r}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }};")
    lines.append(f"\t\t{c_mac} = {{isa = XCConfigurationList; buildConfigurations = ({d_mac_d}, {d_mac_r}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }};")
    lines.append(f"\t\t{c_mgr} = {{isa = XCConfigurationList; buildConfigurations = ({d_mgr_d}, {d_mgr_r}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }};")
    lines.append(f"\t\t{c_watch} = {{isa = XCConfigurationList; buildConfigurations = ({d_watch_d}, {d_watch_r}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }};")
    lines.append("/* End XCConfigurationList section */")

    lines.append("\t};")
    lines.append(f"\trootObject = {proj} /* Project object */;")
    lines.append("}")

    PROJ.write_text("\n".join(lines) + "\n")
    print(f"Wrote {PROJ} with {len(swifts)} Swift files")


if __name__ == "__main__":
    main()
